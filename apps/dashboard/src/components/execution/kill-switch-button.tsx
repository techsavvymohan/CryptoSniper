'use client';

import React, { useState } from 'react';
import { useKillSwitch } from '../../hooks/use-execution';

export function KillSwitchButton() {
  const { isActive, activate, release, isActivating, isReleasing } = useKillSwitch();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleActivate = async () => {
    try {
      await activate('Manual trigger from dashboard');
      setShowConfirm(false);
    } catch (e) {
      alert('Failed to activate kill switch');
    }
  };

  if (isActive) {
    return (
      <div className="bg-red-900/20 border border-red-500 p-4 rounded-lg flex items-center justify-between">
        <span className="text-red-500 font-bold animate-pulse">
          ⚠️ KILL SWITCH ACTIVE — TRADING PAUSED
        </span>
        <button
          onClick={() => release()}
          disabled={isReleasing}
          className="bg-white text-red-600 px-4 py-2 rounded font-medium hover:bg-gray-100 disabled:opacity-50"
        >
          {isReleasing ? 'Releasing...' : 'RELEASE'}
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 transition-colors"
      >
        ⚠️ ACTIVATE KILL SWITCH
      </button>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 p-6 rounded-xl border border-gray-700 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">Are you sure?</h3>
            <p className="text-gray-400 mb-6">
              This will stop ALL trading for 1 hour. Active trades will not be cancelled, 
              but no new opportunities will be executed.
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-600 rounded text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleActivate}
                disabled={isActivating}
                className="flex-1 px-4 py-2 bg-red-600 rounded text-white font-bold hover:bg-red-700 disabled:opacity-50"
              >
                {isActivating ? 'Activating...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
