"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
type Props = {
  open: boolean;
  setOpen: (value: boolean) => void;
  template: any;
  onSuccess: () => void;
};
export default function EditTemplateModal({
  open,
  setOpen,
  template,
  onSuccess,
}: Props) {

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {

    if (template) {

      setTitle(template.title);

      setMessage(template.message);

      setActive(template.is_active);

    }

  }, [template]);
  async function updateTemplate() {

  if (!template) return;

  if (!title.trim()) {

    alert("Enter template title");

    return;

  }

  if (!message.trim()) {

    alert("Enter notification message");

    return;

  }

  setLoading(true);

  const { error } = await supabase
    .from("notifications_templates")
    .update({
      title,
      message,
      is_active: active,
    })
    .eq("id", template.id);

  setLoading(false);

  if (error) {

    alert(error.message);

    return;

  }

  setOpen(false);

  onSuccess();

}

return (

<AnimatePresence>

{open && (

<motion.div

initial={{opacity:0}}

animate={{opacity:1}}

exit={{opacity:0}}

className="
fixed
inset-0
z-[9999]
bg-black/40
backdrop-blur-md
flex
items-center
justify-center
p-5
"

>

<div

className="absolute inset-0"

onClick={()=>setOpen(false)}

/>

<motion.div

initial={{
scale:0.9,
opacity:0,
y:20
}}

animate={{
scale:1,
opacity:1,
y:0
}}

exit={{
scale:0.95,
opacity:0
}}

className="
relative
w-full
max-w-xl
rounded-[30px]
bg-white
shadow-2xl
overflow-hidden
"

>

<div
className="
flex
justify-between
items-center
px-7
py-6
border-b
"
>

<div>

<h1 className="text-2xl font-bold">

Edit Template

</h1>

<p className="text-sm text-slate-500 mt-1">

Update notification template

</p>

</div>

<button

onClick={()=>setOpen(false)}

className="
h-10
w-10
rounded-xl
bg-slate-100
hover:bg-red-500
hover:text-white
transition
flex
items-center
justify-center
"

>

<X size={18}/>

</button>

</div>

<div className="p-7 space-y-5">
<input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Template Title"
                className="
                w-full
                h-12
                rounded-xl
                border
                px-4
                outline-none
                focus:ring-2
                focus:ring-cyan-300
                "
              />

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder="Notification Message"
                className="
                w-full
                rounded-xl
                border
                px-4
                py-3
                outline-none
                resize-none
                focus:ring-2
                focus:ring-cyan-300
                "
              />

              <label className="flex items-center gap-3">

                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) =>
                    setActive(e.target.checked)
                  }
                />

                <span className="text-sm font-medium">
                  Active Template
                </span>

              </label>

            </div>

            <div
              className="
              border-t
              px-7
              py-5
              flex
              justify-end
              gap-3
              "
            >

              <button
                onClick={() => setOpen(false)}
                className="
                px-5
                py-2.5
                rounded-xl
                bg-slate-100
                "
              >
                Cancel
              </button>

              <button
                onClick={updateTemplate}
                disabled={loading}
                className="
                px-6
                py-2.5
                rounded-xl
                text-white
                bg-gradient-to-r
                from-blue-600
                to-cyan-500
                disabled:opacity-50
                "
              >
                {loading ? "Updating..." : "Update Template"}
              </button>

            </div>

          </motion.div>

        </motion.div>

      )}

    </AnimatePresence>

  );

}