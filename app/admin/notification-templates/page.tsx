"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import {
  Plus,
  Bell,
  Pencil,
  Trash2,
  Search,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import AddTemplateModal from "@/components/AddTemplateModal";
import EditTemplateModal from "@/components/EditTemplateModal";
export default function NotificationTemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
const [openAddModal, setOpenAddModal] = useState(false);
const [editingTemplate, setEditingTemplate] = useState<any>(null);
const [openEditModal, setOpenEditModal] = useState(false);
  useEffect(() => {
    loadTemplates();
  }, []);
  async function deleteTemplate(id: number) {

  const confirmDelete = confirm(
    "Delete this template?"
  );

  if (!confirmDelete) return;

  const { error } = await supabase
    .from("notifications_templates")
    .delete()
    .eq("id", id);

  if (error) {

    alert(error.message);

    return;

  }

  loadTemplates();

}

  async function loadTemplates() {
    setLoading(true);

    const { data, error } = await supabase
      .from("notifications_templates")
      .select("*")
      .order("id");

    if (!error) {
      setTemplates(data || []);
    }

    setLoading(false);
  }

  const filteredTemplates = templates.filter((item) => {
    return (
      item.title
        ?.toLowerCase()
        .includes(search.toLowerCase()) ||
      item.message
        ?.toLowerCase()
        .includes(search.toLowerCase())
    );
  });

  return (
    <div className="space-y-6 pb-10">

      {/* HEADER */}

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="
        relative
        overflow-hidden
        rounded-[30px]
        bg-gradient-to-r
        from-slate-900
        via-blue-900
        to-cyan-700
        p-7
        shadow-xl
        "
      >

        <div
          className="
          absolute
          -top-16
          -right-16
          h-52
          w-52
          rounded-full
          bg-white/10
          blur-3xl
          "
        />

        <div className="relative z-10">

          <h1 className="text-4xl font-bold text-white">
            Notification Templates
          </h1>

          <p className="mt-2 text-blue-100">
            Manage all notification slugs used by the system.
          </p>

          <div className="mt-6 flex flex-col md:flex-row gap-4">

            <div
              className="
              flex
              items-center
              gap-3

              rounded-2xl

              bg-white/10

              px-5
              py-3

              backdrop-blur-md

              flex-1
              "
            >

              <Search
                size={18}
                className="text-white"
              />

              <input
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
                placeholder="Search template..."
                className="
                w-full
                bg-transparent
                outline-none
                text-white
                placeholder:text-blue-100
                "
              />

            </div>
<button

onClick={() => setOpenAddModal(true)}

className="
flex
items-center
justify-center
gap-2

rounded-2xl

bg-white

px-6
py-3

font-semibold

text-slate-800

shadow-lg

hover:scale-105

transition
"

>

<Plus size={18}/>

Add Template

</button>

          </div>

        </div>

      </motion.div>

      {/* BODY */}

      {loading ? (

        <div className="text-center py-20">

          Loading...

        </div>

      ) : filteredTemplates.length === 0 ? (

        <div
          className="
          rounded-3xl
          bg-white
          p-12
          text-center
          shadow-md
          "
        >

          <Bell
            size={60}
            className="mx-auto text-blue-500"
          />

          <h2 className="mt-5 text-2xl font-bold">

            No Templates Found

          </h2>

          <p className="mt-2 text-gray-500">

            Create your first notification template.

          </p>

        </div>

      ) : (

        <div
          className="
          grid
          grid-cols-1
          xl:grid-cols-2
          gap-5
          "
        >
            {filteredTemplates.map((item, index) => (

            <motion.div
              key={item.id}
              initial={{
                opacity: 0,
                y: 20
              }}
              animate={{
                opacity: 1,
                y: 0
              }}
              transition={{
                delay: index * 0.05
              }}
              className="
              relative
              overflow-hidden
              rounded-[28px]
              bg-white
              border
              border-slate-100
              shadow-[0_10px_35px_rgba(0,0,0,0.05)]
              hover:shadow-[0_18px_45px_rgba(0,0,0,0.08)]
              transition-all
              duration-300
              "
            >

              <div
                className={`
                absolute
                top-0
                left-0
                h-1
                w-full

                ${
                  item.is_active
                    ? "bg-gradient-to-r from-green-500 to-emerald-400"
                    : "bg-gradient-to-r from-red-500 to-orange-400"
                }
                `}
              />

              <div className="p-6">

                <div className="flex justify-between items-start">

                  <div className="flex gap-4">

                    <div
                      className="
                      h-14
                      w-14
                      rounded-2xl
                      bg-gradient-to-br
                      from-cyan-500
                      to-blue-600
                      flex
                      items-center
                      justify-center
                      text-white
                      shadow-lg
                      "
                    >

                      <Bell size={24} />

                    </div>

                    <div>

                      <h2
                        className="
                        text-xl
                        font-bold
                        text-slate-800
                        "
                      >
                        {item.title}
                      </h2>

                      <p
                        className="
                        mt-2
                        text-sm
                        leading-6
                        text-slate-500
                        "
                      >
                        {item.message}
                      </p>

                    </div>

                  </div>

                  <div>

                    {item.is_active ? (

                      <div
                        className="
                        flex
                        items-center
                        gap-2

                        rounded-full

                        bg-green-100

                        px-3
                        py-1

                        text-xs

                        font-semibold

                        text-green-700
                        "
                      >

                        <CheckCircle2 size={14} />

                        Active

                      </div>

                    ) : (

                      <div
                        className="
                        flex
                        items-center
                        gap-2

                        rounded-full

                        bg-red-100

                        px-3
                        py-1

                        text-xs

                        font-semibold

                        text-red-700
                        "
                      >

                        <XCircle size={14} />

                        Inactive

                      </div>

                    )}

                  </div>

                </div>

                <div
                  className="
                  mt-6

                  flex

                  justify-end

                  gap-3
                  "
                >
<button
  onClick={() => {
    setEditingTemplate(item);
    setOpenEditModal(true);
  }}
  className="..."
>

                    <Pencil size={16} />

                    Edit

                  </button>
<button
  onClick={() => deleteTemplate(item.id)}
  className="..."
>

                    <Trash2 size={16} />

                    Delete

                  </button>

                </div>

              </div>

            </motion.div>

          ))}

        </div>

      )}
<AddTemplateModal
open={openAddModal}
setOpen={setOpenAddModal}
onSuccess={loadTemplates}
/>
<EditTemplateModal
  open={openEditModal}
  setOpen={setOpenEditModal}
  template={editingTemplate}
  onSuccess={loadTemplates}
/>
    </div>

  );

}