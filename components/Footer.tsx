export default function Footer() {
  return (
    <footer className="w-full mt-10 pt-6 border-t border-slate-200">
      <div className="flex flex-col items-center gap-2 pb-4 px-4">
        <div className="flex items-center gap-2">
          <span className="h-px w-6 bg-gradient-to-r from-transparent to-[#B8860B]/40" />
          <p className="text-[11px] font-semibold text-slate-500 tracking-wide">
            DIVYA PADMA INFOSYSTEM LLP
          </p>
          <span className="h-px w-6 bg-gradient-to-l from-transparent to-[#B8860B]/40" />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
          <span className="text-[#9c7a1f] font-bold text-[10.5px]">Mr. Ashwani Srivastava</span>
          <span className="text-slate-300 text-[10px]">&amp;</span>
          <span className="text-[#9c7a1f] font-bold text-[10.5px]">Mrs. Anamika Sinha</span>

          <span className="text-slate-300 text-[9px]">|</span>

          <span className="text-[9.5px] text-slate-400">
            Designed &amp; Developed by <span className="text-slate-500 font-medium">Shivansh Saxena</span>
          </span>

          <span className="text-slate-300 text-[9px]">|</span>

          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[9.5px] font-medium text-slate-500">
            Version 1.0
          </span>
        </div>
      </div>
    </footer>
  );
}