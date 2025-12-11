import React, { useState } from 'react';
import { Search, Plus, Users, Crown, Check } from 'lucide-react';
import { getUserColor, getAdminName } from './utils';
import { useSocket } from '../../contexts/SocketContext';

export const DirectoryView = ({
    activeTab,
    list,
    userList,
    searchQuery, setSearchQuery,
    onSelect,
    onCreateGroupClick
}) => {
    const { user, onlineList } = useSocket();

    if (!list || list.length === 0 || (activeTab === 'USERS' && list.length === 1 && list[0].id === user?.id)) {
        return (<div className="p-8 text-center text-gray-500 text-sm italic">{activeTab === 'USERS' ? "No other users found." : "No groups found."}</div>);
    }

    return (
        <div className="flex-col p-2 space-y-2 overflow-y-auto h-full bg-cabane-dark overscroll-contain">
            {activeTab === 'GROUPS' && <button onClick={onCreateGroupClick} className="w-full py-2 bg-blue-900/30 border border-blue-500/50 text-blue-300 rounded text-xs font-bold flex items-center justify-center gap-2 hover:bg-blue-900/50 mb-2"><Plus size={14} /> New Group</button>}

            <div className="relative mb-2">
                <Search className="absolute left-2 top-2 text-gray-500" size={14} />
                <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded pl-8 p-1.5 text-sm text-white focus:border-blue-500 outline-none" />
            </div>

            {list.filter(i => (i.username || i.name).toLowerCase().includes(searchQuery.toLowerCase()) && i.id !== user?.id).map(item => {
                const isOnline = activeTab === 'USERS' && (onlineList || []).includes(item.username);
                const colorClass = activeTab === 'USERS' ? getUserColor(item.username) : 'border-gray-600 text-gray-400';

                // Note: unreadCount would need to be passed in if we want badges here, or kept in parent logic. 
                // For this split, we handle badges in tabs and open/close, simplifying the list item.
                const adminName = activeTab === 'GROUPS' ? getAdminName(item.created_by, userList) : null;

                return (
                    <div key={item.id} onClick={() => onSelect(item)} className="p-3 bg-gray-800/50 hover:bg-gray-800 rounded border border-gray-700 cursor-pointer flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            {activeTab === 'USERS' ? (
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border bg-gray-900 ${colorClass}`}>{item.username.substring(0, 2).toUpperCase()}</div>
                            ) : (
                                <div className="p-1.5 rounded bg-gray-700 text-gray-300"><Users size={16} /></div>
                            )}
                            <div className="flex flex-col overflow-hidden">
                                <span className="text-sm font-bold text-gray-300">{item.username || item.name}</span>
                                {activeTab === 'GROUPS' && adminName && (
                                    <span className="flex items-center gap-1 text-[10px] text-yellow-500/80"><Crown size={10} /> {adminName}</span>
                                )}
                                {activeTab === 'GROUPS' && <span className="text-[10px] text-gray-500 truncate w-40">{item.members}</span>}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {activeTab === 'USERS' && <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-600'}`} title={isOnline ? "Online" : "Offline"} />}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};