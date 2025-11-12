import React from "react";

export default function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500"></div>
      <p className="ml-4 text-lg font-semibold">Loading LegalSathi...</p>
    </div>
  );
}
