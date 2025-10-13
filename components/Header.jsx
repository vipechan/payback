/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useRef } from 'react';

// --- TYPE DEFINITIONS (for clarity, as if in a .ts file) ---
interface Notification {
  id: string;
  type: 'income' | 'referral' | 'payment_confirmed' | 'payment_received' | 'system';
  message: string;
  timestamp: number;
  isRead: boolean;
}

// Custom hook to detect clicks outside a specified element
const useOutsideClick = (ref, callback) => {
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (ref.current && !ref.current.contains(event.target)) {
                callback();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [ref, callback]);
};

const TimeAgo = ({ timestamp }) => {
    const [timeAgo, setTimeAgo] = useState('');

    useEffect(() => {
        const update = () => {
            const seconds = Math.floor((new Date().getTime() - timestamp) / 1000);
            let interval = seconds / 31536000;
            if (interval > 1) {
                setTimeAgo(Math.floor(interval) + "y ago"); return;
            }
            interval = seconds / 2592000;
            if (interval > 1) {
                setTimeAgo(Math.floor(interval) + "mo ago"); return;
            }
            interval = seconds / 86400;
            if (interval > 1) {
                setTimeAgo(Math.floor(interval) + "d ago"); return;
            }
            interval = seconds / 3600;
            if (interval > 1) {
                setTimeAgo(Math.floor(interval) + "h ago"); return;
            }
            interval = seconds / 60;
            if (interval > 1) {
                setTimeAgo(Math.floor(interval) + "m ago"); return;
            }
            setTimeAgo("Just now");
        };

        update();
        const timer = setInterval(update, 60000); // update every minute
        return () => clearInterval(timer);
    }, [timestamp]);

    return <span className="text-xs text-gray-400">{timeAgo}</span>;
};

const NotificationPanel = ({ notifications, onMarkAsRead, onMarkAllAsRead, onClose }) => {
    const panelRef = useRef(null);
    useOutsideClick(panelRef, onClose);

    const getIcon = (type) => {
        switch (type) {
            case 'income': return { icon: 'fa-money-bill-wave', color: 'text-green-500' };
            case 'referral': return { icon: 'fa-user-plus', color: 'text-blue-500' };
            case 'payment_confirmed': return { icon: 'fa-check-double', color: 'text-purple-500' };
            case 'payment_received': return { icon: 'fa-hand-holding-usd', color: 'text-teal-500' };
            case 'system': return { icon: 'fa-info-circle', color: 'text-gray-500' };
            default: return { icon: 'fa-bell', color: 'text-gray-500' };
        }
    };

    return (
        <div ref={panelRef} className="notification-panel">
            <div className="flex justify-between items-center p-3 border-b">
                <h3 className="font-bold">Notifications</h3>
                <button onClick={onMarkAllAsRead} className="text-sm text-[var(--primary)] hover:underline">Mark all as read</button>
            </div>
            <div className="max-h-[350px] overflow-y-auto">
                {notifications.length > 0 ? (
                    notifications.map(n => {
                        const { icon, color } = getIcon(n.type);
                        return (
                            <div key={n.id} onClick={() => !n.isRead && onMarkAsRead(n.id)} className={`notification-item ${!n.isRead ? 'unread' : ''}`}>
                                <div className={`w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0 ${color} bg-opacity-10 ${color.replace('text-', 'bg-')}`}>
                                    <i className={`fas ${icon}`}></i>
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm text-gray-700">{n.message}</p>
                                    <TimeAgo timestamp={n.timestamp} />
                                </div>
                                {!n.isRead && <div className="w-2 h-2 bg-blue-500 rounded-full ml-2 flex-shrink-0"></div>}
                            </div>
                        )
                    })
                ) : (
                    <p className="text-center text-gray-500 p-6">No new notifications.</p>
                )}
            </div>
        </div>
    );
};

const Header = ({ onToggleSidebar, activeTabLabel, isAdmin, onToggleAdmin, notifications, onMarkAsRead, onMarkAllAsRead }) => {
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const unreadCount = notifications.filter(n => !n.isRead).length;

    return (
        <header className="sticky top-0 bg-gray-100/80 backdrop-blur-sm z-20">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <div className="flex items-center gap-4">
                    <button onClick={onToggleSidebar} className="text-gray-600 hover:text-[var(--primary)] transition-colors">
                        <i className="fas fa-bars text-xl"></i>
                    </button>
                    <h1 className="text-xl font-bold text-gray-800 hidden sm:block">
                        {activeTabLabel}
                    </h1>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative">
                        <button onClick={() => setIsPanelOpen(prev => !prev)} className="notification-bell">
                            <i className="far fa-bell text-xl"></i>
                            {unreadCount > 0 && (
                                <span className="notification-badge">{unreadCount}</span>
                            )}
                        </button>
                        {isPanelOpen && (
                            <NotificationPanel
                                notifications={notifications}
                                onMarkAsRead={onMarkAsRead}
                                onMarkAllAsRead={() => {
                                    onMarkAllAsRead();
                                    setIsPanelOpen(false);
                                }}
                                onClose={() => setIsPanelOpen(false)}
                            />
                        )}
                    </div>
                    <div className="flex items-center gap-2 bg-white border border-gray-200 p-1 rounded-full">
                        <span className="text-xs font-bold px-2 text-gray-700 hidden md:inline">Admin Mode</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={isAdmin} onChange={(e) => onToggleAdmin(e.target.checked)} className="sr-only peer" />
                            <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-[var(--primary)]/50 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                        </label>
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;
