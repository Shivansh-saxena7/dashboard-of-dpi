"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Plus, X, ArrowRightLeft, Trash2, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import DeleteModal from "../components/DeleteModal";

const NEW_PROJECT_SENTINEL = "__new__";

interface Rule {
  id: string;
  project: string;
  assigned_employee_id: string;
}

interface Employee {
  id: string;
  name: string;
}

// Admin-only management for project_assignment_rules — a project
// listed here bypasses round robin entirely (lib/calculateLeadAssignment.ts
// checks this before anything else). One project can now have MULTIPLE
// fixed employees (Phase 7B) — new leads for it round-robin among just
// that group, scoped separately via project_rule_pointers.
//
// Plain sequential Supabase calls throughout (no RPC needed for CRUD
// here) — same "trusted Admin action on data Admin already has RLS
// access to" precedent as Teams/Leads pages. The one exception is
// migrating EXISTING active leads (reassign_project_leads_atomic) —
// that's a multi-row, multi-table write across leads + lead_history,
// exactly the kind of thing that needs an atomic transaction, unlike
// simply adding/removing a rule row.
export default function ProjectRulesPage() {

  const [rules, setRules] = useState<Rule[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [newProjectSelect, setNewProjectSelect] = useState("");
  const [newProjectFreeText, setNewProjectFreeText] = useState("");
  const [newProjectEmployeeId, setNewProjectEmployeeId] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const [addEmployeeProject, setAddEmployeeProject] = useState<string | null>(null);
  const [addEmployeeId, setAddEmployeeId] = useState("");
  const [addingEmployee, setAddingEmployee] = useState(false);

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

    const [{ data: rulesData }, { data: employeesData }, { data: leadsData }] = await Promise.all([
      supabase.from("project_assignment_rules").select("id, project, assigned_employee_id").order("project"),
      supabase.from("employees").select("id, name").order("name"),
      supabase.from("leads").select("project")
    ]);

    setRules(rulesData || []);
    setEmployees(employeesData || []);
    setProjectOptions(
      Array.from(new Set((leadsData || []).map((l) => l.project).filter(Boolean))).sort() as string[]
    );
    setLoading(false);
  }

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((e) => map.set(e.id, e.name));
    return map;
  }, [employees]);

  const groupedRules = useMemo(() => {
    const map = new Map<string, Rule[]>();
    rules.forEach((r) => {
      if (!map.has(r.project)) map.set(r.project, []);
      map.get(r.project)!.push(r);
    });
    return Array.from(map.entries()).map(([project, members]) => ({ project, members }));
  }, [rules]);

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

  async function handleRemoveEmployee(ruleId: string) {
    const { error } = await supabase.from("project_assignment_rules").delete().eq("id", ruleId);

    if (error) {
      toast.error(error.message || "Could not remove employee.");
      return;
    }

    toast.success("Removed from rule.");
    loadData();
  }

  async function handleDeleteProjectRule() {
    if (!deleteProjectTarget) return;

    setDeletingProject(true);

    const { error } = await supabase
      .from("project_assignment_rules")
      .delete()
      .eq("project", deleteProjectTarget);

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
          Projects listed here bypass round robin — leads always go to their fixed employee(s).
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

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading...</div>
      ) : groupedRules.length === 0 ? (
        <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-10 text-center text-sm text-slate-400">
          No project rules yet — all leads go through normal round robin.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groupedRules.map(({ project, members }) => (
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
                  title="Delete this project's rule entirely"
                  className="shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-red-50 border border-red-100 text-red-500 text-xs font-bold hover:bg-red-100 transition"
                >
                  <Trash2 size={13} />
                  Delete Rule
                </button>
              </div>

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
          ))}
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
            : `This removes ALL fixed employees for "${deleteProjectTarget}" — future leads for this project will go through normal round robin instead. Existing active leads are untouched (use Migrate on each employee first if you want to move them too).`
        }
      />
    </div>
  );
}
