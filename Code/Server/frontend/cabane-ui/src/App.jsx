import { SocketProvider, useSocket } from './contexts/SocketContext';
import { RockerSwitch } from './components/controls/RockerSwitch';
import { HaloButton } from './components/controls/HaloButton';

function Dashboard() {
  const { systemState, toggleSwitch, takeControl, releaseControl, isConnected } = useSocket();
  const isRemote = systemState.controller === 'USER';

  // Helper to handle momentary buttons
  const handleMomentary = (idx, val) => toggleSwitch(idx, val);

  return (
    <div className="min-h-screen bg-cabane-dark text-white p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-10 border-b border-gray-700 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-wider">CABANE CONTROL</h1>
          <div className="flex items-center gap-2 text-sm mt-1">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            <span>{isConnected ? "Server Online" : "Connecting..."}</span>
            <span className="text-gray-500">|</span>
            <span className="text-yellow-500">Controller: {systemState.controller}</span>
          </div>
        </div>

        <button
          onClick={isRemote ? releaseControl : takeControl}
          className={`px-6 py-2 rounded font-bold uppercase transition-colors ${isRemote
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-blue-600 hover:bg-blue-700'
            }`}
        >
          {isRemote ? "Release Control" : "Take Control"}
        </button>
      </div>

      {/* Test Area */}
      <div className="grid grid-cols-4 gap-8 max-w-2xl mx-auto p-6 bg-cabane-panel rounded-xl shadow-2xl">

        {/* Rocker: Index 4 (ST1 - Vic T1) */}
        <RockerSwitch
          label="VIC T1 (ST1)"
          isOn={!!systemState.virtualSwitches[4]}
          physicalOn={!!systemState.physicalSwitches[4]}
          isLocked={!isRemote}
          onChange={(val) => toggleSwitch(4, val)}
        />

        {/* Button: Index 1 (ST1 - Transport 2) */}
        <HaloButton
          label="TRANSP 2"
          color="green"
          isLocked={!isRemote}
          onPress={() => handleMomentary(1, true)}
          onRelease={() => handleMomentary(1, false)}
        />

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