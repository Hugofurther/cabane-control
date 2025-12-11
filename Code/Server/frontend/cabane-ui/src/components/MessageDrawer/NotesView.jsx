import React, { useState } from 'react';
import { Search, Plus, StickyNote, Share2, Trash2, Copy, Zap, Lock } from 'lucide-react';
import { useSocket } from '../../contexts/SocketContext';

export const NotesView = ({
    notes,
    onViewNote,
    onCreateNote,
    onDeleteNote,
    onCopyNote,
    onShareNote,
    onFlashNote
}) => {
    const { user } = useSocket();
    const [noteSearch, setNoteSearch] = useState('');
    const [isCreatingNote, setIsCreatingNote] = useState(false);
    const [newNoteTitle, setNewNoteTitle] = useState('');

    const handleCreate = () => {
        if (!newNoteTitle.trim()) return;
        onCreateNote(newNoteTitle);
        setNewNoteTitle('');
        setIsCreatingNote(false);
    };

    const filteredNotes = notes.filter(n =>
        n.title.toLowerCase().includes(noteSearch.toLowerCase()) ||
        (n.content || "").toLowerCase().includes(noteSearch.toLowerCase())
    );

    return (
        <div className="flex flex-col h-full bg-cabane-dark">
            {/* TOOLBAR */}
            <div className="p-3 bg-gray-900 border-b border-gray-700 flex gap-2">
                <div className="relative flex-grow">
                    <Search className="absolute left-2 top-2 text-gray-500" size={14} />
                    <input
                        type="text"
                        placeholder="Search notes..."
                        value={noteSearch}
                        onChange={e => setNoteSearch(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded pl-8 pr-8 p-1.5 text-sm text-white outline-none focus:border-blue-500 transition-colors"
                    />
                </div>
                <button onClick={() => setIsCreatingNote(!isCreatingNote)} className="bg-blue-600 p-2 rounded text-white hover:bg-blue-500"><Plus size={16} /></button>
            </div>

            {/* CREATE UI */}
            {isCreatingNote && (
                <div className="p-3 bg-gray-800 border-b border-gray-700 flex gap-2 animate-in slide-in-from-top-2">
                    <input
                        type="text"
                        placeholder="Note Title..."
                        value={newNoteTitle}
                        onChange={e => setNewNoteTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                        className="flex-grow bg-gray-900 border border-gray-600 rounded p-1.5 text-sm text-white outline-none"
                        autoFocus
                    />
                    <button onClick={handleCreate} className="bg-green-600 px-3 py-1 rounded text-xs font-bold text-white uppercase shadow hover:bg-green-500">Create</button>
                </div>
            )}

            {/* LIST */}
            <div className="flex-grow overflow-y-auto p-2 space-y-2">
                {filteredNotes.map(note => {
                    const isOwner = note.is_owner === 1;
                    return (
                        <div key={note.id} onClick={() => onViewNote(note)} className="bg-gray-800 border border-gray-700 rounded p-3 cursor-pointer hover:border-blue-500 transition-colors group relative">
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-2">
                                    {isOwner ? <StickyNote size={16} className="text-yellow-500" /> : <Share2 size={16} className="text-blue-400" />}
                                    <h4 className="font-bold text-gray-200 text-sm">{note.title}</h4>
                                </div>
                                <span className="text-[10px] text-gray-500">{new Date(note.updated_at).toLocaleDateString()}</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-1 truncate">{note.content || "No content"}</p>
                            {!isOwner && <p className="text-[10px] text-blue-400 mt-1 flex items-center gap-1"><Lock size={10} /> Shared by {note.creator_name}</p>}

                            {/* ACTIONS (Hover) */}
                            <div className="absolute right-2 bottom-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 p-1 rounded shadow-lg border border-gray-700">
                                {isOwner && (
                                    <>
                                        <button onClick={(e) => { e.stopPropagation(); onShareNote(note, false); }} className="p-1.5 hover:bg-blue-900/50 text-blue-400 rounded" title="Share"><Share2 size={12} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); onShareNote(note, true); }} className="p-1.5 hover:bg-yellow-900/50 text-yellow-400 rounded" title="Flash Memo"><Zap size={12} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); onDeleteNote(note.id); }} className="p-1.5 hover:bg-red-900/50 text-red-400 rounded" title="Delete"><Trash2 size={12} /></button>
                                    </>
                                )}
                                {!isOwner && (
                                    <>
                                        <button onClick={(e) => { e.stopPropagation(); onShareNote(note, false); }} className="p-1.5 hover:bg-blue-900/50 text-blue-400 rounded" title="Re-Share"><Share2 size={12} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); onShareNote(note, true); }} className="p-1.5 hover:bg-yellow-900/50 text-yellow-400 rounded" title="Flash Memo"><Zap size={12} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); onCopyNote(note.id); }} className="p-1.5 hover:bg-green-900/50 text-green-400 rounded" title="Save Copy"><Copy size={12} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); onDeleteNote(note.id); }} className="p-1.5 hover:bg-red-900/50 text-red-400 rounded" title="Dismiss Share"><Trash2 size={12} /></button>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
                {filteredNotes.length === 0 && <div className="text-center text-gray-500 text-xs italic mt-10">No notes found.</div>}
            </div>
        </div>
    );
};