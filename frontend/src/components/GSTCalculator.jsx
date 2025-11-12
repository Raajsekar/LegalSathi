import React, { useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE;

export default function GSTCalculator() {
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(18);
  const [inclusive, setInclusive] = useState(false);
  const [interstate, setInterstate] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const calc = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/gst/calc`, {
        amount: Number(amount),
        rate: Number(rate),
        inclusive,
        interstate
      });
      setResult(res.data);
    } catch (e) {
      console.error(e);
      alert("Calculation failed");
    }
    setLoading(false);
  };

  return (
    <div className="p-4 bg-gray-800 rounded">
      <h3 className="font-semibold text-lg mb-2">GST Calculator</h3>
      <div className="flex gap-2 mb-2">
        <input className="p-2 rounded bg-gray-900 text-white" placeholder="Amount" value={amount} onChange={(e)=>setAmount(e.target.value)} />
        <select className="p-2 rounded bg-gray-900 text-white" value={rate} onChange={(e)=>setRate(e.target.value)}>
          <option value="0">0%</option>
          <option value="5">5%</option>
          <option value="12">12%</option>
          <option value="18">18%</option>
          <option value="28">28%</option>
        </select>
      </div>
      <div className="flex gap-4 items-center mb-3">
        <label className="text-sm"><input type="checkbox" checked={inclusive} onChange={(e)=>setInclusive(e.target.checked)} /> Inclusive</label>
        <label className="text-sm"><input type="checkbox" checked={interstate} onChange={(e)=>setInterstate(e.target.checked)} /> Interstate (IGST)</label>
      </div>
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-blue-600 rounded" onClick={calc} disabled={loading}>{loading ? "..." : "Calculate"}</button>
        <button className="px-4 py-2 bg-gray-600 rounded" onClick={()=>{ setAmount(""); setResult(null); }}>Reset</button>
      </div>

      {result && (
        <div className="mt-4 bg-gray-900 p-3 rounded">
          <div>Base: ₹{result.base_amount}</div>
          <div>GST ({result.rate_percent}%): ₹{result.gst_amount}</div>
          {result.igst ? <div>IGST: ₹{result.igst}</div> : <><div>CGST: ₹{result.cgst}</div><div>SGST: ₹{result.sgst}</div></>}
          <div className="font-semibold mt-2">Total: ₹{result.total_amount}</div>
        </div>
      )}
    </div>
  );
}
