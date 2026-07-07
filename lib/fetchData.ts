export async function fetchData() {
  const res = await fetch(
    "https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnQzdV7iMZkHN90G9qWWWFNsROo8or48DtsWCPRQGTD1OvmPAHgx0yrZvG4d59IcpASzOEdRjDIx_0ke2vPmWcJcwGPWONkBdCgzDGozg9eV0e_4dmf_LLTV8TrG-E-qYIcH3Fcs2TLJAewEktIMTz6z-paZR_h_yA5lDhY769fcnIMCHeyDooxTlwMFTCii67Wp9b4s-dst7E5d8Lu7fznjGRy-1VKb-oCOFkIm5fp7bjjl8FPxvPDI499VxPCy3jTXbDSW8XLkaHkVMppTZFnYxNQ0RQ&lib=MIKvktAk9t9EAHW-KPkN37_l0nAi76pU6"
  );

  const data = await res.json();
  return data;
}