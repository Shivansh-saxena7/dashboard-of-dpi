"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  X,
  CalendarDays,
  Sparkles,
  Clock3,
} from "lucide-react";

type Notification = {
  id: string | number;
  title: string;
  message: string;
  created_at: string;
  is_read?: boolean;
};

type Props = {
  notifications: Notification[];
  onClose: () => void;
};

function formatDate(date: string) {
  const d = new Date(date);

  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationModal({
  notifications,
  onClose,
}: Props) {
  return (
    <AnimatePresence>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="
        fixed
        inset-0
        z-[9999]
        bg-black/60
        backdrop-blur-xl
        flex
        items-center
        justify-center
        p-3
        sm:p-5
        "
      >

        {/* Overlay */}

        <div
          className="absolute inset-0"
          onClick={onClose}
        />

        {/* Main Modal */}

        <motion.div
          initial={{
            opacity: 0,
            scale: .95,
            y: 30,
          }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
          }}
          exit={{
            opacity: 0,
            scale: .95,
            y: 20,
          }}
          transition={{
            duration: .25,
          }}
          className="
          relative
          z-10

          w-full
          max-w-3xl

          h-[88vh]
          max-h-[900px]

          rounded-[32px]

          bg-white/95
          backdrop-blur-2xl

          border
          border-white/60

          shadow-[0_35px_120px_rgba(0,0,0,.35)]

          overflow-hidden

          flex
          flex-col
          "
        >

          {/* HEADER */}

          <div
            className="
            sticky
            top-0
            z-20

            px-5
            sm:px-7

            py-5

            bg-white/90
            backdrop-blur-xl

            border-b
            border-gray-200

            flex
            items-center
            justify-between
            "
          >

            <div className="flex items-center gap-4">

              <div
                className="
                h-14
                w-14

                rounded-2xl

                bg-gradient-to-br
                from-blue-500
                via-indigo-500
                to-violet-600

                text-white

                flex
                items-center
                justify-center

                shadow-lg
                "
              >

                <Bell size={24} />

              </div>

              <div>

                <h2 className="text-2xl font-bold text-gray-800">
                  Notification Center
                </h2>

                <p className="text-sm text-gray-500 mt-1">

                  {notifications.length} Notification
                  {notifications.length !== 1
                    ? "s"
                    : ""}

                </p>

              </div>

            </div>

            <button
              onClick={onClose}
              className="
              h-11
              w-11

              rounded-2xl

              bg-gray-100

              hover:bg-red-500
              hover:text-white

              transition-all
              duration-300

              flex
              items-center
              justify-center
              "
            >

              <X size={20} />

            </button>

          </div>

          {/* BODY */}

          <div
            className="
            flex-1

            overflow-y-auto

            px-5
            sm:px-6

            py-5
            "
          >
            {notifications.length === 0 ? (

              <div className="h-full flex flex-col items-center justify-center text-center px-6">

                <div
                  className="
                  h-28
                  w-28

                  rounded-full

                  bg-gradient-to-br
                  from-blue-100
                  to-indigo-100

                  flex
                  items-center
                  justify-center

                  shadow-inner
                  "
                >

                  <Bell
                    size={48}
                    className="text-blue-600"
                  />

                </div>

                <h3 className="mt-8 text-2xl font-bold text-gray-800">
                  You're All Caught Up 🎉
                </h3>

                <p className="mt-3 text-gray-500 max-w-sm leading-7">
                  No notifications available.
                  Whenever admin assigns a new post,
                  it will instantly appear here.
                </p>

              </div>

            ) : (

              <div className="space-y-4">

                {notifications.map((item, index) => (

                  <motion.div
                    key={item.id}
                    initial={{
                      opacity: 0,
                      y: 15,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    transition={{
                      delay: index * .05,
                    }}
                    className="
                    group

                    relative

                    rounded-3xl

                    border
                    border-gray-200

                    bg-gradient-to-br
                    from-white
                    to-slate-50

                    p-5

                    shadow-sm

                    hover:shadow-xl
                    hover:-translate-y-1

                    transition-all
                    duration-300
                    "
                  >

                    {!item.is_read && (

                      <div
                        className="
                        absolute
                        left-0
                        top-0
                        bottom-0

                        w-1.5

                        rounded-l-3xl

                        bg-gradient-to-b
                        from-blue-500
                        to-violet-600
                        "
                      />

                    )}

                    <div className="flex justify-between gap-4">

                      <div className="flex gap-4">

                        <div
                          className="
                          h-12
                          w-12

                          rounded-2xl

                          bg-blue-100

                          flex
                          items-center
                          justify-center
                          "
                        >

                          <Sparkles
                            size={22}
                            className="text-blue-600"
                          />

                        </div>

                        <div>

                          <h3 className="font-bold text-lg text-gray-800">

                            {item.title}

                          </h3>

                          <p className="mt-2 text-gray-600 leading-7">

                            {item.message}

                          </p>

                        </div>

                      </div>

                      {!item.is_read && (

                        <div
                          className="
                          h-3
                          w-3

                          rounded-full

                          bg-blue-500

                          animate-pulse

                          mt-2
                          "
                        />

                      )}

                    </div>

                    <div
                      className="
                      mt-5

                      flex
                      items-center
                      justify-between
                      flex-wrap

                      gap-3
                      "
                    >

                      <div
                        className="
                        inline-flex
                        items-center
                        gap-2

                        rounded-full

                        bg-blue-50

                        px-4
                        py-2

                        text-xs
                        font-semibold
                        text-blue-700
                        "
                      >

                        <Bell size={14} />

                        POST ASSIGNED

                      </div>

                      <div
                        className="
                        flex
                        items-center
                        gap-2

                        text-xs
                        text-gray-500
                        "
                      >

                        <Clock3 size={14} />

                        {formatDate(item.created_at)}

                      </div>

                    </div>

                  </motion.div>

                ))}

              </div>

            )}

          </div>

          {/* FOOTER */}

          <div
            className="
            sticky
            bottom-0

            bg-white/90

            backdrop-blur-xl

            border-t

            px-6
            py-4

            flex
            items-center
            justify-between
            "
          >

            <div className="text-sm text-gray-500">

              End of Notifications

            </div>

            <button
              onClick={onClose}
              className="
              px-6
              py-3

              rounded-2xl

              bg-gradient-to-r
              from-blue-600
              to-indigo-600

              text-white
              font-semibold

              hover:scale-105

              transition-all
              duration-300

              shadow-lg
              "
            >

              Close

            </button>

          </div>

        </motion.div>

      </motion.div>

    </AnimatePresence>

  );

}