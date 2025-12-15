import i18n from '../../i18n'; // ✅ Import the instance directly

export const getUserColor = (username) => {
    // ... (logic remains same)
    if (!username) return 'border-gray-500 text-gray-400 bg-gray-800';
    const colors = ['border-emerald-500 text-emerald-400 bg-emerald-900/10', 'border-purple-500 text-purple-400 bg-purple-900/10', 'border-orange-500 text-orange-400 bg-orange-900/10', 'border-pink-500 text-pink-400 bg-pink-900/10', 'border-cyan-500 text-cyan-400 bg-cyan-900/10', 'border-indigo-500 text-indigo-400 bg-indigo-900/10'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
};

export const formatSmartTime = (isoString) => {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isToday) return time;
    // ✅ TRANSLATED:
    if (isYesterday) return `${i18n.t('common.yesterday')} ${time}`;
    return `${date.toLocaleDateString()} ${time}`;
};

export const getAdminName = (adminId, userList) => {
    if (!adminId || !userList) return null;
    const u = userList.find(user => user.id === adminId);
    // ✅ TRANSLATED:
    return u ? u.username : i18n.t('common.unknown');
};