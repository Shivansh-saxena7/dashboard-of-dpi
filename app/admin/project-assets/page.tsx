"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { Plus, Trash2, ChevronDown, ChevronRight, Video, FileText, Upload, Tag, X, Link2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

const BUCKET = "project-assets";

interface Project {
  id: string;
  name: string;
  is_active: boolean;
  meta_dataset_id: string | null;
}

interface MetaDatasetOption {
  id: string;
  label: string;
}

interface Alias {
  id: string;
  alias_text: string;
  project_id: string;
}

interface AssetGroup {
  id: string;
  project_id: string;
  label: string;
  sort_order: number;
}

interface Asset {
  id: string;
  asset_group_id: string;
  label: string;
  asset_type: "VIDEO" | "FILE";
  video_url: string | null;
  storage_path: string | null;
  file_mime_type: string | null;
}

// Admin-only management page for the Project -> Size/Type -> Assets
// repository (Part 1 of the Assets module). No RPCs for the CRUD
// itself — plain table writes under RLS, same convention as
// project_assignment_rules/AddEmployeeModal etc. (RPCs in this app
// are reserved for cross-table/business-logic operations, not single-
// table CRUD). File uploads go through Supabase Storage's own client
// API, separate from RPCs entirely.
export default function ProjectAssetsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");

  const [aliases, setAliases] = useState<Alias[]>([]);
  const [newAlias, setNewAlias] = useState("");

  const [groups, setGroups] = useState<AssetGroup[]>([]);
  const [assetsByGroup, setAssetsByGroup] = useState<Record<string, Asset[]>>({});
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [newGroupLabel, setNewGroupLabel] = useState("");

  const [videoLabel, setVideoLabel] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const [metaDatasets, setMetaDatasets] = useState<MetaDatasetOption[]>([]);
  const [savingDatasetLink, setSavingDatasetLink] = useState(false);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  useEffect(() => {
    loadProjects();
    loadMetaDatasets();
  }, []);

  // Feature: meta-capi-integration (2026-08-19). Plain client-side
  // read — meta_datasets carries no sensitive data itself (the access
  // token lives only in Vault, referenced by id), same reasoning the
  // admin_all RLS policy on that table already relies on.
  async function loadMetaDatasets() {
    const { data } = await supabase.from("meta_datasets").select("id, label").eq("is_active", true).order("label");
    setMetaDatasets(data || []);
  }

  // Plain table write, not an RPC — meta_dataset_id is just a project-
  // to-dataset link, not a secret, so this follows the exact same
  // "plain writes under RLS" convention this whole page already uses
  // for aliases/groups/assets (see the file-level comment above).
  async function updateProjectMetaDataset(projectId: string, newDatasetId: string | null) {
    setSavingDatasetLink(true);
    const { error } = await supabase
      .from("projects")
      .update({ meta_dataset_id: newDatasetId })
      .eq("id", projectId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Meta Dataset updated.");
      await loadProjects();
    }
    setSavingDatasetLink(false);
  }

  useEffect(() => {
    if (selectedProjectId) {
      loadProjectDetail(selectedProjectId);
    } else {
      setAliases([]);
      setGroups([]);
      setAssetsByGroup({});
    }
  }, [selectedProjectId]);

  async function loadProjects() {
    const { data } = await supabase.from("projects").select("*").order("name");
    setProjects(data || []);
    if (!selectedProjectId && data && data.length > 0) {
      setSelectedProjectId(data[0].id);
    }
  }

  async function loadProjectDetail(projectId: string) {
    const [{ data: aliasRows }, { data: groupRows }] = await Promise.all([
      supabase.from("project_aliases").select("*").eq("project_id", projectId).order("alias_text"),
      supabase.from("project_asset_groups").select("*").eq("project_id", projectId).order("sort_order")
    ]);

    setAliases(aliasRows || []);
    setGroups(groupRows || []);

    const groupIds = (groupRows || []).map((g) => g.id);
    if (groupIds.length > 0) {
      const { data: assetRows } = await supabase
        .from("project_assets")
        .select("*")
        .in("asset_group_id", groupIds)
        .order("sort_order");

      const grouped: Record<string, Asset[]> = {};
      (assetRows || []).forEach((a) => {
        grouped[a.asset_group_id] = grouped[a.asset_group_id] || [];
        grouped[a.asset_group_id].push(a);
      });
      setAssetsByGroup(grouped);
    } else {
      setAssetsByGroup({});
    }
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;

    const { data, error } = await supabase.from("projects").insert({ name }).select().single();
    if (error) {
      toast.error(error.message.includes("duplicate") ? "This project already exists." : error.message);
      return;
    }
    toast.success("Project created.");
    setNewProjectName("");
    await loadProjects();
    setSelectedProjectId(data.id);
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and ALL its size-groups and assets? This cannot be undone.")) return;
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Project deleted.");
    if (selectedProjectId === id) setSelectedProjectId(null);
    await loadProjects();
  }

  async function addAlias() {
    const text = newAlias.trim();
    if (!text || !selectedProjectId) return;

    const { error } = await supabase.from("project_aliases").insert({ project_id: selectedProjectId, alias_text: text });
    if (error) {
      toast.error(error.message.includes("duplicate") ? "This spelling is already linked somewhere." : error.message);
      return;
    }
    setNewAlias("");
    await loadProjectDetail(selectedProjectId);
  }

  async function deleteAlias(id: string) {
    await supabase.from("project_aliases").delete().eq("id", id);
    if (selectedProjectId) await loadProjectDetail(selectedProjectId);
  }

  async function addGroup() {
    const label = newGroupLabel.trim();
    if (!label || !selectedProjectId) return;

    const { error } = await supabase.from("project_asset_groups").insert({
      project_id: selectedProjectId,
      label,
      sort_order: groups.length
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewGroupLabel("");
    await loadProjectDetail(selectedProjectId);
  }

  async function deleteGroup(id: string) {
    if (!confirm("Delete this size/type and all its assets?")) return;
    await supabase.from("project_asset_groups").delete().eq("id", id);
    if (selectedProjectId) await loadProjectDetail(selectedProjectId);
  }

  async function addVideoAsset(groupId: string) {
    const label = videoLabel.trim();
    const url = videoUrl.trim();
    if (!label || !url) {
      toast.error("Label and YouTube link both required.");
      return;
    }

    const { error } = await supabase.from("project_assets").insert({
      asset_group_id: groupId,
      label,
      asset_type: "VIDEO",
      video_url: url,
      sort_order: (assetsByGroup[groupId] || []).length
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setVideoLabel("");
    setVideoUrl("");
    if (selectedProjectId) await loadProjectDetail(selectedProjectId);
  }

  async function uploadFileAssets(groupId: string, files: FileList) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = `${selectedProjectId}/${groupId}/${Date.now()}-${file.name}`;

        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
        if (uploadError) {
          toast.error(`${file.name}: ${uploadError.message}`);
          continue;
        }

        const {
          data: { user }
        } = await supabase.auth.getUser();
        const { data: employee } = await supabase.from("employees").select("id").eq("auth_user_id", user?.id).single();

        const { error: insertError } = await supabase.from("project_assets").insert({
          asset_group_id: groupId,
          label: file.name.replace(/\.[^.]+$/, ""),
          asset_type: "FILE",
          storage_path: path,
          file_mime_type: file.type,
          sort_order: (assetsByGroup[groupId] || []).length,
          uploaded_by: employee?.id ?? null
        });

        if (insertError) {
          toast.error(`${file.name}: ${insertError.message}`);
        }
      }
      toast.success("Upload complete.");
      if (selectedProjectId) await loadProjectDetail(selectedProjectId);
    } finally {
      setUploading(false);
    }
  }

  async function deleteAsset(asset: Asset) {
    if (!confirm(`Delete "${asset.label}"?`)) return;

    if (asset.asset_type === "FILE" && asset.storage_path) {
      await supabase.storage.from(BUCKET).remove([asset.storage_path]);
    }
    await supabase.from("project_assets").delete().eq("id", asset.id);
    if (selectedProjectId) await loadProjectDetail(selectedProjectId);
  }

  function fileUrl(path: string) {
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Project Assets</h1>
        <p className="text-sm text-slate-500 mt-1">
          Videos, brochures, and images organized by Project → Size/Type — shown to employees on the matching lead's detail page.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        {/* Project list */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 h-fit">
          <div className="flex gap-2 mb-3">
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              placeholder="New project name..."
              className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs outline-none focus:ring-2 focus:ring-cyan-200"
            />
            <button onClick={createProject} className="h-9 w-9 rounded-lg bg-cyan-500 text-white flex items-center justify-center shrink-0">
              <Plus size={16} />
            </button>
          </div>

          <div className="space-y-1">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-sm ${
                  selectedProjectId === p.id ? "bg-cyan-50 text-cyan-700 font-semibold" : "hover:bg-slate-50 text-slate-600"
                }`}
                onClick={() => setSelectedProjectId(p.id)}
              >
                <span className="truncate">{p.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProject(p.id);
                  }}
                  className="text-slate-300 hover:text-red-500 shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {projects.length === 0 && <p className="text-xs text-slate-400 px-1">No projects yet.</p>}
          </div>
        </div>

        {/* Selected project detail */}
        {!selectedProject ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-sm text-slate-400">
            Select or create a project to manage its sizes and assets.
          </div>
        ) : (
          <div className="space-y-5">
            {/* Meta Dataset link (feature: meta-capi-integration, 2026-08-19) */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Link2 size={14} className="text-slate-400" />
                <h3 className="text-sm font-bold text-slate-700">Meta Dataset</h3>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Leads is-project-se genuinely-jab CONNECTED/Follow-up/Visit/Booking hongi, tab is-Dataset-ko
                Meta Conversions API signal jaayega. Blank = koi signal nahi jaayega is-project-ke-liye.
              </p>
              <select
                value={selectedProject.meta_dataset_id || ""}
                onChange={(e) => updateProjectMetaDataset(selectedProject.id, e.target.value || null)}
                disabled={savingDatasetLink}
                className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs outline-none focus:ring-2 focus:ring-cyan-200 disabled:opacity-60"
              >
                <option value="">— No Dataset linked —</option>
                {metaDatasets.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>

            {/* Aliases */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Tag size={14} className="text-slate-400" />
                <h3 className="text-sm font-bold text-slate-700">Also known as (legacy spellings)</h3>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                A lead tagged with any of these exact spellings will also find this project&apos;s assets — useful for leads already in the system with inconsistent project names.
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {aliases.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-slate-100 text-xs text-slate-600">
                    {a.alias_text}
                    <button onClick={() => deleteAlias(a.id)} className="text-slate-400 hover:text-red-500">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addAlias()}
                  placeholder='e.g. "kviraj" or "Kviraj MAYFAIR"'
                  className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs outline-none focus:ring-2 focus:ring-cyan-200"
                />
                <button onClick={addAlias} className="h-9 px-3 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
                  Add
                </button>
              </div>
            </div>

            {/* Size/Type groups */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <h3 className="text-sm font-bold text-slate-700 mb-3">Sizes / Types</h3>

              <div className="flex gap-2 mb-4">
                <input
                  value={newGroupLabel}
                  onChange={(e) => setNewGroupLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addGroup()}
                  placeholder='e.g. "2BHK - 1200 sqft"'
                  className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs outline-none focus:ring-2 focus:ring-cyan-200"
                />
                <button onClick={addGroup} className="h-9 px-3 rounded-lg bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5">
                  <Plus size={14} /> Add Size
                </button>
              </div>

              <div className="space-y-2">
                {groups.map((g) => {
                  const isOpen = expandedGroupId === g.id;
                  const assets = assetsByGroup[g.id] || [];

                  return (
                    <div key={g.id} className="border border-slate-100 rounded-xl overflow-hidden">
                      <div
                        className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-50 cursor-pointer"
                        onClick={() => setExpandedGroupId(isOpen ? null : g.id)}
                      >
                        <div className="flex items-center gap-2">
                          {isOpen ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                          <span className="text-sm font-semibold text-slate-700">{g.label}</span>
                          <span className="text-[11px] text-slate-400">({assets.length} asset{assets.length === 1 ? "" : "s"})</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteGroup(g.id);
                          }}
                          className="text-slate-300 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <AnimatePresence>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-4 space-y-3">
                              {assets.map((a) => (
                                <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-white border border-slate-100">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {a.asset_type === "VIDEO" ? (
                                      <Video size={15} className="text-red-500 shrink-0" />
                                    ) : (
                                      <FileText size={15} className="text-blue-500 shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-slate-700 truncate">{a.label}</p>
                                      {a.asset_type === "VIDEO" ? (
                                        <a href={a.video_url!} target="_blank" rel="noreferrer" className="text-[11px] text-cyan-600 truncate block">
                                          {a.video_url}
                                        </a>
                                      ) : (
                                        <a href={fileUrl(a.storage_path!)} target="_blank" rel="noreferrer" className="text-[11px] text-cyan-600">
                                          View file
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                  <button onClick={() => deleteAsset(a)} className="text-slate-300 hover:text-red-500 shrink-0">
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              ))}

                              <div className="pt-2 border-t border-slate-100 space-y-3">
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <input
                                    value={videoLabel}
                                    onChange={(e) => setVideoLabel(e.target.value)}
                                    placeholder='Video label, e.g. "2BHK Walkthrough"'
                                    className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
                                  />
                                  <input
                                    value={videoUrl}
                                    onChange={(e) => setVideoUrl(e.target.value)}
                                    placeholder="YouTube link (unlisted)"
                                    className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
                                  />
                                  <button
                                    onClick={() => addVideoAsset(g.id)}
                                    className="h-9 px-3 rounded-lg bg-red-50 text-red-600 text-xs font-bold flex items-center gap-1.5 shrink-0"
                                  >
                                    <Video size={13} /> Add Video
                                  </button>
                                </div>

                                <label className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-50 text-blue-600 text-xs font-bold w-fit cursor-pointer">
                                  <Upload size={13} /> {uploading ? "Uploading..." : "Upload File(s) (PDF / Image / Excel)"}
                                  <input
                                    type="file"
                                    multiple
                                    accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx"
                                    className="hidden"
                                    disabled={uploading}
                                    onChange={(e) => e.target.files && uploadFileAssets(g.id, e.target.files)}
                                  />
                                </label>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
                {groups.length === 0 && <p className="text-xs text-slate-400 px-1">No sizes/types added yet.</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
