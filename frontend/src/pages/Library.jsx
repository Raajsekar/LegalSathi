import React, { useEffect, useState } from "react";
import axios from "axios";
import { auth } from "../firebase";

const API_BASE = import.meta.env.VITE_API_BASE;

export default function Library() {
  const [files, setFiles] = useState([]);
  const user = auth.currentUser;

  useEffect(() => {
    if (!user) return;
    axios.get(`${API_BASE}/api/files/${user.uid}`)
         .then(r => setFiles(r.data || []))
         .catch(e => console.error(e));
  }, [user]);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-4">Library</h2>
      <div className="space-y-4">
        {files.length === 0 && <div className="text-gray-400">No files yet.</div>}
        {files.map(f => (
          <div key={f._id} className="bg-white/5 p-3 rounded flex justify-between items-center">
            <div>
              <div className="font-medium">{f.original_name}</div>
              <div className="text-sm text-gray-400">{new Date(f.timestamp*1000).toLocaleString()}</div>
            </div>
            <div>
              {f.pdf && <a href={`${API_BASE}/download/${f.pdf}`} className="mr-2 bg-blue-600 px-2 py-1 rounded">Download Summary PDF</a>}
              <a href="#" onClick={() => {/* open preview or message */}} className="text-sm">Open</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
