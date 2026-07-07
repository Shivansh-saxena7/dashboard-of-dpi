"use client";

type Props = {
  employees: {
    id: string;
    name: string;
    employeeId?: string;
  }[];

  selected: string;
  setSelected: any;
  data: any[];
};

export default function EmployeeList({
  employees,
  selected,
  setSelected,
  data,
}: Props) {

  const total = data.length;

  const completed = data.filter(
    (d: any) =>
      d["IG Like"] === "YES" ||
      d["FB Like"] === "YES"
  ).length;

  const missed = data.filter(
    (d: any) =>
      d["IG Like"] !== "YES" &&
      d["FB Like"] !== "YES"
  ).length;

  const performance =
    total > 0
      ? Math.round((completed / total) * 100)
      : 0;

  const employeeName =
    employees.find(
      (e: any) =>
        e.employeeId === selected ||
        e.id === selected
    )?.name || "Employee";

  return (
    <div className="bg-white/60 backdrop-blur-xl p-5 rounded-2xl border border-white/40 shadow-lg h-full">

      <div className="flex items-center justify-between mb-4">

        <div>
          <h2 className="text-lg font-semibold text-gray-800">
            Your Weekly Status
          </h2>

          <p className="text-xs text-gray-500 mt-1">
            Personal performance overview
          </p>
        </div>

        <div className="text-2xl">
          📊
        </div>

      </div>

      <div className="bg-gradient-to-r from-violet-50 via-pink-50 to-purple-50 border border-violet-100 rounded-2xl p-4 mb-4">

        <div className="flex items-start justify-between gap-3">

          <div>

            <p className="text-xs text-gray-500">
              Logged In Employee
            </p>

            <h3 className="text-xl font-bold text-gray-800 mt-1">
              {employeeName}
            </h3>

            <p className="text-xs text-gray-500 mt-3 leading-relaxed max-w-[220px]">
              Consistent social engagement strengthens brand trust,
              visibility, and long-term company growth.
            </p>

          </div>

          <div className="h-12 w-12 rounded-full bg-violet-500 text-white flex items-center justify-center font-bold text-lg shadow-md">

            {employeeName?.charAt(0)}

          </div>

        </div>

      </div>

      <div className="grid grid-cols-2 gap-3">

        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3">

          <p className="text-xs text-gray-500">
            Total Posts
          </p>

          <h4 className="text-2xl font-bold text-blue-600 mt-1">
            {total}
          </h4>

        </div>

        <div className="bg-green-50 border border-green-100 rounded-2xl p-3">

          <p className="text-xs text-gray-500">
            Completed
          </p>

          <h4 className="text-2xl font-bold text-green-600 mt-1">
            {completed}
          </h4>

        </div>

        <div className="bg-red-50 border border-red-100 rounded-2xl p-3">

          <p className="text-xs text-gray-500">
            Missed
          </p>

          <h4 className="text-2xl font-bold text-red-500 mt-1">
            {missed}
          </h4>

        </div>

        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-3">

          <p className="text-xs text-gray-500">
            Performance
          </p>

          <h4 className="text-2xl font-bold text-violet-600 mt-1">
            {performance}%
          </h4>

        </div>

      </div>

    </div>
  );
}