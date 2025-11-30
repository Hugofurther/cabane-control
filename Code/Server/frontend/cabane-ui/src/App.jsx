import React from 'react';
import { SocketProvider, useSocket } from './contexts/SocketContext';
import { StationCard } from './components/StationCard';
// ✅ FIX: Import the correct name 'PANEL_LAYOUT'
import { PANEL_LAYOUT } from './config/stations';

function Dashboard() {
  const { systemState, takeControl, releaseToServer, releaseToCabane, isConnected, user } = useSocket();

  // Logic: Am I driving?
  const canInteract = systemState.controller !== 'CABANE';

  return (
    <div className="min-h-screen bg-cabane-dark text-white p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 border-b border-gray-700 pb-4 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-widest text-gray-100">CABANE CONTROL</h1>
          <div className="flex items-center gap-3 text-sm mt-1">
            <span className={`w-3 h-3 rounded-full shadow ${isConnected ? 'bg-green-500 shadow-green-500/50' : 'bg-red-500 shadow-red-500/50'}`}></span>
            <span className="text-gray-400 uppercase tracking-wide">{isConnected ? "Online" : "Connecting..."}</span>
            <span className="text-gray-600">|</span>
            <span className={`font-mono font-bold ${systemState.controller === 'CABANE' ? 'text-yellow-500' : 'text-blue-400'}`}>
              MASTER: {systemState.controller}
              {systemState.currentUser ? ` (${systemState.currentUser})` : ''}
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          {/* 1. TAKE CONTROL (Visible if I am NOT the active User) */}
          {systemState.currentUser !== user?.username && (
            <button
              onClick={takeControl}
              className="px-6 py-3 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase shadow-lg shadow-blue-900/50 transition-all"
            >
              Take Control
            </button>
          )}

          {/* 2. RELEASE OPTIONS (Visible if I AM the active User) */}
          {systemState.controller === 'USER' && systemState.currentUser === user?.username && (
            <>
              <button
                onClick={releaseToServer}
                className="px-4 py-3 rounded bg-yellow-600 hover:bg-yellow-500 text-white font-bold uppercase shadow-lg transition-all"
              >
                Release (Hold)
              </button>
              <button
                onClick={releaseToCabane}
                className="px-4 py-3 rounded bg-red-600 hover:bg-red-500 text-white font-bold uppercase shadow-lg transition-all"
              >
                To Cabane
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Grid - Updated for Row Layout */}
      <div className="flex flex-col gap-6 max-w-7xl mx-auto">
        {PANEL_LAYOUT.map((row) => (
          <div key={row.id} className={`grid gap-6 ${row.cols}`}>
            {row.cards.map((card, i) => (
              <StationCard
                key={i}
                card={card}
                isRemote={canInteract}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SocketProvider>
      <Dashboard />
    </SocketProvider>
  );
}