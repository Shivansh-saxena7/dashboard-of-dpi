"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Plus, X, ArrowRightLeft, Trash2, ChevronDown, Ban, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import DeleteModal from "../components/DeleteModal";

const NEW_PROJECT_SENTINEL = "__new__";

interface Rule {
  id: string;
  project: string;
  assigned_employee_id: string;
}

interface ExclusionRule {
  id: string;
  project: string;
  excluded_employee_id: string;
}

interface Employee {
  id: string;
  name: string;
}

// Employee-Project-Allowlist (2026-09-24) — a RESTRICTION, not a
// RESERVATION: an employee with any rows here is eligible ONLY for
// the projects listed; an employee with zero rows stays fully
// unrestricted, same as today. See lib/calculateLeadAssignment.ts's
// own comment on EmployeeProjectAllowlistRule for the full rule, and
// its interaction with Fixed Employees above (a project with a fixed
// employee bypasses this check entirely, same precedence Excluded
// Employees already has).
interface AllowlistRule {
  id: string;
  employee_id: string;
  project: string;
}

// Admin-only management for project_assignment_rules (INCLUDE — a
// project listed here bypasses round robin entirely,
// lib/calculateLeadAssignment.ts checks this before anything else)
// AND project_exclusion_rules (EXCLUDE — the opposite: one employee
// blocked from round-robin leads for a project, everyone else stays
// in the normal pool). Two separate tables, not one with a
// rule_type discriminator — every existing INCLUDE consumer assumes
// every row it reads IS a fixed-employee rule with zero filtering;
// a shared table would need each of those retrofitted correctly, and
// a missed one would silently treat an excluded employee as a fixed
// one. EXCLUDE only ever matters for a project with NO INCLUDE rule
// — calculateLeadAssignment's INCLUDE branch returns before EXCLUDE
// is ever consulted, so that precedence just falls out of existing
// control flow, nothing enforced here in the UI either (a project can
// have both rows present; the INCLUDE one simply wins, per that
// function's control flow — an "Exclude has no effect" note is shown
// instead of hard-blocking the combination).
//
// One project can now have MULTIPLE fixed employees (Phase 7B) — new
// leads for it round-robin among just that group, scoped separately
// via project_rule_pointers.
//
// Plain sequential Supabase calls throughout (no RPC needed for CRUD
// here) — same "trusted Admin action on data Admin already has RLS
// access to" precedent as Teams/Leads pages. The one exception is
// migrating EXISTING active leads (reassign_project_leads_atomic) —
// that's a multi-row, multi-table write across leads + lead_history,
// exactly the kind of thing that needs an atomic transaction, unlike
// simply adding/removing a rule row. EXCLUDE rules never migrate
// existing leads either — same "only affects future distribution"
// posture INCLUDE rules already have.
export default function ProjectRulesPage() {

  const [rules, setRules] = useState<Rule[]>([]);
  const [exclusions, setExclusions] = useState<ExclusionRule[]>([]);
  const [allowlists, setAllowlists] = useState<AllowlistRule[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [newAllowlistEmployeeId, setNewAllowlistEmployeeId] = useState("");
  const [newAllowlistProjects, setNewAllowlistProjects] = useState<Set<string>>(new Set());
  const [creatingAllowlist, setCreatingAllowlist] = useState(false);

  const [addAllowlistProjectFor, setAddAllowlistProjectFor] = useState<string | null>(null);
  const [addAllowlistProjectSelections, setAddAllowlistProjectSelections] = useState<Set<string>>(new Set());
  const [addingAllowlistProjects, setAddingAllowlistProjects] = useState(false);

  const [newProjectSelect, setNewProjectSelect] = useState("");
  const [newProjectFreeText, setNewProjectFreeText] = useState("");
  const [newProjectEmployeeId, setNewProjectEmployeeId] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const [newExcludeProjectSelect, setNewExcludeProjectSelect] = useState("");
  const [newExcludeProjectFreeText, setNewExcludeProjectFreeText] = useState("");
  const [newExcludeEmployeeId, setNewExcludeEmployeeId] = useState("");
  const [creatingExclusion, setCreatingExclusion] = useState(false);

  const [addEmployeeProject, setAddEmployeeProject] = useState<string | null>(null);
  const [addEmployeeId, setAddEmployeeId] = useState("");
  const [addingEmployee, setAddingEmployee] = useState(false);

  const [addExcludeProject, setAddExcludeProject] = useState<string | null>(null);
  const [addExcludeId, setAddExcludeId] = useState("");
  const [addingExclude, setAddingExclude] = useState(false);

  const [migrateTarget, setMigrateTarget] = useState<{ project: string; fromEmployeeId: string } | null>(null);
  const [migrateToEmployeeId, setMigrateToEmployeeId] = useState("");
  const [migrating, setMigrating] = useState(false);

  const [deleteProjectTarget, setDeleteProjectTarget] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    // leads_distinct_projects (2026-09-18) instead of reading every
    // lead row's project column directly — that used to silently
    // truncate at PostgREST's 1000-row cap, capable of missing a
    // project name that only appears in leads past row ~1000. The
    // view is already the source of truth for "every distinct project
    // that's ever appeared on a lead" — no need to re-derive it here.
    const [{ data: rulesData }, { data: exclusionsData }, { data: allowlistsData }, { data: employeesData }, { data: projectsData }] =
      await Promise.all([
        supabase.from("project_assignment_rules").select("id, project, assigned_employee_id").order("project"),
        supabase.from("project_exclusion_rules").select("id, project, excluded_employee_id").order("project"),
        supabase.from("employee_project_allowlist").select("id, employee_id, project").order("project"),
        supabase.from("employees").select("id, name").order("name"),
        supabase.from("leads_distinct_projects").select("project").order("project")
      ]);

    setRules(rulesData || []);
    setExclusions(exclusionsData || []);
    setAllowlists(allowlistsData || []);
    setEmployees(employeesData || []);
    setProjectOptions((projectsData || []).map((p) => p.project).filter(Boolean) as string[]);
    setLoading(false);
  }

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((e) => map.set(e.id, e.name));
    return map;
  }, [employees]);

  const includesByProject = useMemo(() => {
    const map = new Map<string, Rule[]>();
    rules.forEach((r) => {
      if (!map.has(r.project)) map.set(r.project, []);
      map.get(r.project)!.push(r);
    });
    return map;
  }, [rules]);

  const excludesByProject = useMemo(() => {
    const map = new Map<string, ExclusionRule[]>();
    exclusions.forEach((r) => {
      if (!map.has(r.project)) map.set(r.project, []);
      map.get(r.project)!.push(r);
    });
    return map;
  }, [exclusions]);

  // Every project with EITHER kind of rule gets a card — a project
  // with only EXCLUDE rows (the common case: no fixed employees,
  // just one person blocked) needs to show up just as much as one
  // with only INCLUDE rows.
  const allProjectsWithRules = useMemo(() => {
    const projects = new Set<string>([...includesByProject.keys(), ...excludesByProject.keys()]);
    return Array.from(projects).sort();
  }, [includesByProject, excludesByProject]);

  // Grouped by EMPLOYEE, not project — unlike the two above, this
  // mechanism is employee-scoped (per the approved plan), so "one card
  // per employee with any allowlist rows" is the natural display, not
  // "one card per project."
  const allowlistsByEmployee = useMemo(() => {
    const map = new Map<string, AllowlistRule[]>();
    allowlists.forEach((a) => {
      if (!map.has(a.employee_id)) map.set(a.employee_id, []);
      map.get(a.employee_id)!.push(a);
    });
    return map;
  }, [allowlists]);

  const employeesWithAllowlist = useMemo(() => {
    return Array.from(allowlistsByEmployee.keys()).sort((a, b) =>
      (employeeNameById.get(a) || "").localeCompare(employeeNameById.get(b) || "")
    );
  }, [allowlistsByEmployee, employeeNameById]);

  async function handleCreateNewProject() {
    const finalProject = newProjectSelect === NEW_PROJECT_SENTINEL
      ? newProjectFreeText.trim()
      : newProjectSelect;

    if (!finalProject || !newProjectEmployeeId) {
      toast.error("Select or enter a project name, and select an employee.");
      return;
    }

    setCreatingProject(true);

    const { error } = await supabase.from("project_assignment_rules").insert({
      project: finalProject,
      assigned_employee_id: newProjectEmployeeId
    });

    if (error) {
      toast.error(error.message || "Could not create rule.");
    } else {
      toast.success("Project rule created.");
      setNewProjectSelect("");
      setNewProjectFreeText("");
      setNewProjectEmployeeId("");
      loadData();
    }

    setCreatingProject(false);
  }

  async function handleCreateExclusion() {
    const finalProject = newExcludeProjectSelect === NEW_PROJECT_SENTINEL
      ? newExcludeProjectFreeText.trim()
      : newExcludeProjectSelect;

    if (!finalProject || !newExcludeEmployeeId) {
      toast.error("Select or enter a project name, and select an employee.");
      return;
    }

    setCreatingExclusion(true);

    const { error } = await supabase.from("project_exclusion_rules").insert({
      project: finalProject,
      excluded_employee_id: newExcludeEmployeeId
    });

    if (error) {
      toast.error(error.message || "Could not create exclusion.");
    } else {
      toast.success("Employee excluded from this project.");
      setNewExcludeProjectSelect("");
      setNewExcludeProjectFreeText("");
      setNewExcludeEmployeeId("");
      loadData();
    }

    setCreatingExclusion(false);
  }

  async function handleAddEmployeeToProject(project: string) {
    if (!addEmployeeId) return;

    setAddingEmployee(true);

    const { error } = await supabase.from("project_assignment_rules").insert({
      project,
      assigned_employee_id: addEmployeeId
    });

    if (error) {
      toast.error(error.message || "Could not add employee.");
    } else {
      toast.success("Employee added.");
      setAddEmployeeProject(null);
      setAddEmployeeId("");
      loadData();
    }

    setAddingEmployee(false);
  }

  async function handleAddExclusion(project: string) {
    if (!addExcludeId) return;

    setAddingExclude(true);

    const { error } = await supabase.from("project_exclusion_rules").insert({
      project,
      excluded_employee_id: addExcludeId
    });

    if (error) {
      toast.error(error.message || "Could not exclude this employee.");
    } else {
      toast.success("Employee excluded from this project.");
      setAddExcludeProject(null);
      setAddExcludeId("");
      loadData();
    }

    setAddingExclude(false);
  }

  async function handleRemoveEmployee(ruleId: string) {
    const { error } = await supabase.from("project_assignment_rules").delete().eq("id", ruleId);

    if (error) {
      toast.error(error.message || "Could not remove employee.");
      return;
    }

    toast.success("Removed from rule.");
    loadData();
  }

  async function handleRemoveExclusion(exclusionId: string) {
    const { error } = await supabase.from("project_exclusion_rules").delete().eq("id", exclusionId);

    if (error) {
      toast.error(error.message || "Could not remove exclusion.");
      return;
    }

    toast.success("Exclusion removed.");
    loadData();
  }

  function toggleNewAllowlistProject(project: string) {
    setNewAllowlistProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  }

  async function handleCreateAllowlist() {
    if (!newAllowlistEmployeeId || newAllowlistProjects.size === 0) {
      toast.error("Select an employee and at least one project.");
      return;
    }

    setCreatingAllowlist(true);

    const { error } = await supabase.from("employee_project_allowlist").insert(
      Array.from(newAllowlistProjects).map((project) => ({
        employee_id: newAllowlistEmployeeId,
        project
      }))
    );

    if (error) {
      toast.error(error.message || "Could not create allowlist.");
    } else {
      toast.success("Allowlist created — this employee is now restricted to the selected projects.");
      setNewAllowlistEmployeeId("");
      setNewAllowlistProjects(new Set());
      loadData();
    }

    setCreatingAllowlist(false);
  }

  function toggleAddAllowlistProject(project: string) {
    setAddAllowlistProjectSelections((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  }

  async function handleAddProjectsToAllowlist(employeeId: string) {
    if (addAllowlistProjectSelections.size === 0) return;

    setAddingAllowlistProjects(true);

    const { error } = await supabase.from("employee_project_allowlist").insert(
      Array.from(addAllowlistProjectSelections).map((project) => ({
        employee_id: employeeId,
        project
      }))
    );

    if (error) {
      toast.error(error.message || "Could not add projects.");
    } else {
      toast.success("Projects added to allowlist.");
      setAddAllowlistProjectFor(null);
      setAddAllowlistProjectSelections(new Set());
      loadData();
    }

    setAddingAllowlistProjects(false);
  }

  async function handleRemoveAllowlistEntry(entryId: string) {
    const { error } = await supabase.from("employee_project_allowlist").delete().eq("id", entryId);

    if (error) {
      toast.error(error.message || "Could not remove this project.");
      return;
    }

    toast.success("Removed from allowlist.");
    loadData();
  }

  // Clears BOTH tables for this project — "Delete Rule" is meant to
  // read as "delete this project's whole rule-configuration," not
  // just the INCLUDE half. Leaving EXCLUDE rows behind would silently
  // resurrect the card after the next loadData() (allProjectsWithRules
  // still finds it via excludesByProject).
  async function handleDeleteProjectRule() {
    if (!deleteProjectTarget) return;

    setDeletingProject(true);

    const [{ error: includeError }, { error: excludeError }] = await Promise.all([
      supabase.from("project_assignment_rules").delete().eq("project", deleteProjectTarget),
      supabase.from("project_exclusion_rules").delete().eq("project", deleteProjectTarget)
    ]);

    const error = includeError || excludeError;

    if (error) {
      toast.error(error.message || "Could not delete this rule.");
      setDeletingProject(false);
      return;
    }

    toast.success("Project rule deleted — this project now goes through normal round robin.");
    setDeleteProjectTarget(null);
    setDeletingProject(false);
    loadData();
  }

  async function handleMigrateLeads() {
    if (!migrateTarget || !migrateToEmployeeId) return;

    setMigrating(true);

    const { data, error } = await supabase.rpc("reassign_project_leads_atomic", {
      p_project: migrateTarget.project,
      p_old_employee_id: migrateTarget.fromEmployeeId,
      p_new_employee_id: migrateToEmployeeId
    });

    if (error) {
      toast.error(error.message || "Could not migrate leads.");
      setMigrating(false);
      return;
    }

    const count = typeof data === "number" ? data : 0;
    toast.success(count > 0 ? `${count} active lead(s) migrated.` : "No active leads to migrate for this employee.");
    setMigrateTarget(null);
    setMigrateToEmployeeId("");
    setMigrating(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">Project Rules</h1>
        <p className="text-slate-500 mt-1">
          Fixed employees bypass round robin entirely. Excluded employees stay in normal round robin for every other project — just not this one.
        </p>
      </div>

      <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3">New Project Rule</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <select
              value={newProjectSelect}
              onChange={(e) => setNewProjectSelect(e.target.value)}
              className="appearance-none w-full h-11 rounded-xl bg-slate-50 border border-slate-200 pl-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="" disabled>Select a project...</option>
              {projectOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value={NEW_PROJECT_SENTINEL}>+ Add new project</option>
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>

          {newProjectSelect === NEW_PROJECT_SENTINEL && (
            <input
              value={newProjectFreeText}
              onChange={(e) => setNewProjectFreeText(e.target.value)}
              placeholder="New project name..."
              className="flex-1 h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
          )}

          <select
            value={newProjectEmployeeId}
            onChange={(e) => setNewProjectEmployeeId(e.target.value)}
            className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="">Select employee...</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <button
            onClick={handleCreateNewProject}
            disabled={creatingProject}
            className="h-11 px-5 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Create
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3">New Excluded Employee</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <select
              value={newExcludeProjectSelect}
              onChange={(e) => setNewExcludeProjectSelect(e.target.value)}
              className="appearance-none w-full h-11 rounded-xl bg-slate-50 border border-slate-200 pl-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-red-200"
            >
              <option value="" disabled>Select a project...</option>
              {projectOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value={NEW_PROJECT_SENTINEL}>+ Add new project</option>
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>

          {newExcludeProjectSelect === NEW_PROJECT_SENTINEL && (
            <input
              value={newExcludeProjectFreeText}
              onChange={(e) => setNewExcludeProjectFreeText(e.target.value)}
              placeholder="New project name..."
              className="flex-1 h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-red-200"
            />
          )}

          <select
            value={newExcludeEmployeeId}
            onChange={(e) => setNewExcludeEmployeeId(e.target.value)}
            className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-red-200"
          >
            <option value="">Select employee...</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <button
            onClick={handleCreateExclusion}
            disabled={creatingExclusion}
            className="h-11 px-5 rounded-xl font-semibold text-white bg-gradient-to-r from-red-500 to-rose-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Ban size={16} />
            Exclude
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          Blocks this employee from round-robin leads for this project — everyone else keeps getting them normally. Has no effect on a project that already has Fixed Employees below.
        </p>
      </div>

      <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3">Employee Project Allowlist</p>
        <p className="text-[11px] text-slate-400 mb-3">
          A restriction, not a reservation: an employee given an allowlist can ONLY receive leads for the projects checked below. An employee with no allowlist stays fully unrestricted, same as today. Has no effect on a project that has a Fixed Employee above — that always wins.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 items-start">
          <select
            value={newAllowlistEmployeeId}
            onChange={(e) => setNewAllowlistEmployeeId(e.target.value)}
            className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
          >
            <option value="">Select employee...</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>

          <div className="flex-1 flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200 min-h-[44px]">
            {projectOptions.length === 0 ? (
              <span className="text-xs text-slate-400 px-1">No projects yet.</span>
            ) : (
              projectOptions.map((p) => (
                <label
                  key={p}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer select-none ${
                    newAllowlistProjects.has(p) ? "bg-emerald-100 text-emerald-800 font-semibold" : "bg-white text-slate-600 border border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={newAllowlistProjects.has(p)}
                    onChange={() => toggleNewAllowlistProject(p)}
                    className="accent-emerald-600"
                  />
                  {p}
                </label>
              ))
            )}
          </div>

          <button
            onClick={handleCreateAllowlist}
            disabled={creatingAllowlist}
            className="h-11 px-5 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-500 disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
          >
            <ShieldCheck size={16} />
            Create
          </button>
        </div>
      </div>

      {employeesWithAllowlist.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {employeesWithAllowlist.map((employeeId) => {
            const entries = allowlistsByEmployee.get(employeeId) || [];
            const allowedProjects = new Set(entries.map((e) => e.project));

            return (
              <motion.div
                key={employeeId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-[24px] border border-emerald-100 shadow-md p-5"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                    <ShieldCheck size={16} className="text-emerald-600" />
                  </div>
                  <p className="text-sm font-bold text-slate-800 truncate">{employeeNameById.get(employeeId) || "Unknown"}</p>
                </div>

                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-1.5">
                  Restricted To
                </p>
                <div className="space-y-1.5">
                  {entries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-50/60">
                      <span className="text-sm text-slate-700">{entry.project}</span>
                      <button
                        onClick={() => handleRemoveAllowlistEntry(entry.id)}
                        title="Remove this project from the allowlist"
                        className="h-7 w-7 rounded-lg bg-red-50 flex items-center justify-center text-red-500 hover:bg-red-100 transition"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                {addAllowlistProjectFor === employeeId ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200">
                      {projectOptions.filter((p) => !allowedProjects.has(p)).map((p) => (
                        <label
                          key={p}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer select-none ${
                            addAllowlistProjectSelections.has(p) ? "bg-emerald-100 text-emerald-800 font-semibold" : "bg-white text-slate-600 border border-slate-200"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={addAllowlistProjectSelections.has(p)}
                            onChange={() => toggleAddAllowlistProject(p)}
                            className="accent-emerald-600"
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAddProjectsToAllowlist(employeeId)}
                        disabled={addingAllowlistProjects || addAllowlistProjectSelections.size === 0}
                        className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setAddAllowlistProjectFor(null); setAddAllowlistProjectSelections(new Set()); }}
                        className="h-9 px-2 text-xs text-slate-400"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddAllowlistProjectFor(employeeId)}
                    className="flex items-center gap-1 mt-3 text-xs font-bold text-emerald-700 hover:text-emerald-800"
                  >
                    <Plus size={12} />
                    Add Project
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading...</div>
      ) : allProjectsWithRules.length === 0 ? (
        <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-10 text-center text-sm text-slate-400">
          No project rules yet — all leads go through normal round robin.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {allProjectsWithRules.map((project) => {
            const members = includesByProject.get(project) || [];
            const excludedMembers = excludesByProject.get(project) || [];

            return (
              <motion.div
                key={project}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-[24px] border border-slate-100 shadow-md p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <Building2 size={16} className="text-blue-600" />
                    </div>
                    <p className="text-sm font-bold text-slate-800 truncate">{project}</p>
                  </div>
                  {/* Icon-only + hover-title was too easy to miss (title
                      tooltips don't even show on touch) — visible text
                      label makes this discoverable without relying on
                      hover. Same handler/modal as before, just clearer. */}
                  <button
                    onClick={() => setDeleteProjectTarget(project)}
                    title="Delete every rule (fixed + excluded) for this project"
                    className="shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-red-50 border border-red-100 text-red-500 text-xs font-bold hover:bg-red-100 transition"
                  >
                    <Trash2 size={13} />
                    Delete Rule
                  </button>
                </div>

                {members.length > 0 && (
                  <>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-1.5">
                      Fixed Employees
                    </p>
                    <div className="space-y-1.5">
                      {members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50">
                          <span className="text-sm text-slate-700">{employeeNameById.get(m.assigned_employee_id) || "Unknown"}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setMigrateTarget({ project, fromEmployeeId: m.assigned_employee_id });
                                setMigrateToEmployeeId("");
                              }}
                              title="Migrate their active leads for this project to someone else"
                              className="h-7 w-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 hover:bg-blue-100 transition"
                            >
                              <ArrowRightLeft size={12} />
                            </button>
                            <button
                              onClick={() => handleRemoveEmployee(m.id)}
                              title="Remove from this project's rule"
                              className="h-7 w-7 rounded-lg bg-red-50 flex items-center justify-center text-red-500 hover:bg-red-100 transition"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {members.length > 1 && (
                      <p className="text-[11px] text-slate-400 mt-2">
                        {members.length} fixed employees — new leads round-robin among just this group.
                      </p>
                    )}

                    {addEmployeeProject === project ? (
                      <div className="flex items-center gap-2 mt-3">
                        <select
                          value={addEmployeeId}
                          onChange={(e) => setAddEmployeeId(e.target.value)}
                          className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
                        >
                          <option value="">Select employee...</option>
                          {employees
                            .filter((e) => !members.some((m) => m.assigned_employee_id === e.id))
                            .map((e) => (
                              <option key={e.id} value={e.id}>{e.name}</option>
                            ))}
                        </select>
                        <button
                          onClick={() => handleAddEmployeeToProject(project)}
                          disabled={addingEmployee || !addEmployeeId}
                          className="h-9 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => { setAddEmployeeProject(null); setAddEmployeeId(""); }}
                          className="h-9 px-2 text-xs text-slate-400"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddEmployeeProject(project)}
                        className="flex items-center gap-1 mt-3 text-xs font-bold text-blue-700 hover:text-blue-800"
                      >
                        <Plus size={12} />
                        Add Employee
                      </button>
                    )}
                  </>
                )}

                <div className={members.length > 0 ? "mt-4 pt-4 border-t border-slate-100" : ""}>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-1.5">
                    Excluded Employees
                  </p>

                  {members.length > 0 && (
                    <p className="text-[11px] text-amber-600 mb-2">
                      Fixed Employees are set for this project — Exclude rules have no effect until those are removed.
                    </p>
                  )}

                  {excludedMembers.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {excludedMembers.map((ex) => (
                        <div key={ex.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-red-50/60">
                          <span className="text-sm text-slate-700">{employeeNameById.get(ex.excluded_employee_id) || "Unknown"}</span>
                          <button
                            onClick={() => handleRemoveExclusion(ex.id)}
                            title="Remove this exclusion"
                            className="h-7 w-7 rounded-lg bg-red-50 flex items-center justify-center text-red-500 hover:bg-red-100 transition"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {addExcludeProject === project ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={addExcludeId}
                        onChange={(e) => setAddExcludeId(e.target.value)}
                        className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
                      >
                        <option value="">Select employee...</option>
                        {employees
                          .filter((e) => !excludedMembers.some((ex) => ex.excluded_employee_id === e.id))
                          .map((e) => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                          ))}
                      </select>
                      <button
                        onClick={() => handleAddExclusion(project)}
                        disabled={addingExclude || !addExcludeId}
                        className="h-9 px-3 rounded-lg bg-red-500 text-white text-xs font-bold disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setAddExcludeProject(null); setAddExcludeId(""); }}
                        className="h-9 px-2 text-xs text-slate-400"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddExcludeProject(project)}
                      className="flex items-center gap-1 text-xs font-bold text-red-600 hover:text-red-700"
                    >
                      <Plus size={12} />
                      Exclude Employee
                    </button>
                  )}
                </div>

                {migrateTarget?.project === project && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    <p className="text-[11px] text-slate-500">
                      Migrate {employeeNameById.get(migrateTarget.fromEmployeeId) || "this employee"}'s active leads for "{project}" to:
                    </p>
                    <div className="flex items-center gap-2">
                      <select
                        value={migrateToEmployeeId}
                        onChange={(e) => setMigrateToEmployeeId(e.target.value)}
                        className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
                      >
                        <option value="">Select employee...</option>
                        {employees
                          .filter((e) => e.id !== migrateTarget.fromEmployeeId)
                          .map((e) => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                          ))}
                      </select>
                      <button
                        onClick={handleMigrateLeads}
                        disabled={migrating || !migrateToEmployeeId}
                        className="h-9 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50"
                      >
                        {migrating ? "..." : "Migrate"}
                      </button>
                      <button
                        onClick={() => { setMigrateTarget(null); setMigrateToEmployeeId(""); }}
                        className="h-9 px-2 text-xs text-slate-400"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <DeleteModal
        open={Boolean(deleteProjectTarget)}
        setOpen={(open: boolean) => !open && setDeleteProjectTarget(null)}
        onDelete={handleDeleteProjectRule}
        title="Delete Project Rule"
        message={
          deletingProject
            ? "Deleting..."
            : `This removes ALL fixed employees AND all excluded employees for "${deleteProjectTarget}" — future leads for this project will go through normal round robin instead, open to everyone. Existing active leads are untouched (use Migrate on each fixed employee first if you want to move them too).`
        }
      />
    </div>
  );
}
