/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';


// --- CONSTANTS ---
const PAYMENT_TIMER_DURATION = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
const API_KEY = process.env.API_KEY;

// --- TYPE DEFINITIONS ---
interface Notification {
  id: string;
  type: 'income' | 'referral' | 'payment_confirmed' | 'payment_received' | 'system';
  message: string;
  timestamp: number;
  isRead: boolean;
}

interface Payment {
    id: string;
    title: string;
    amount: number;
    description: string;
    receiverContact: string;
    type: string;
    iconClass: string;
    status: 'unpaid' | 'pending' | 'confirmed' | 'expired' | 'verifying' | 'failed' | 'disputed';
    transactionId: string;
    proof: string | null;
    qrCodeUrl: string;
    bankAccount: {
        name: string;
        number: string;
        ifsc: string;
    };
    upiId: string;
    usdtAddress: string;
    assignedTimestamp: number | null;
    receiverId: string;
    uniqueUsdtAmount?: number;
}

interface Transaction {
    date: string;
    type: string;
    details: string;
    amount: number;
    status: string;
}

interface Confirmation {
    id: string;
    paymentId?: string;
    senderName: string;
    amount: number;
    transactionId: string;
    proof: string;
    date: string;
    type: string;
    submittedTimestamp: number;
    receiverId: string;
    paymentTitle: string;
}

interface AdminUser {
    id: string;
    name: string;
    profilePicture: string;
    joinDate: string;
    paymentsConfirmed: number;
    totalPayments: number;
    notes: string;
    status: 'active' | 'pending' | 'on_hold';
    transactions: {
        date: string;
        type: string;
        details: string;
        amount: number;
        status: string;
    }[];
}

interface GenealogyNode {
    id: string;
    name: string;
    profilePicture: string;
    joinDate: string;
    position: 'left' | 'right' | 'root';
    children: (GenealogyNode | null)[];
}

interface SystemConfig {
    referralAmount: number;
    binaryAmount: number;
    uplineAmount: number;
    adminFeeAmount: number;
}

interface AdminPaymentOption {
    id: string;
    name: string;
    upiId: string;
    bankAccount: {
        name: string;
        number: string;
        ifsc: string;
    };
    usdtAddress: string;
    qrCodeUrl: string | null;
    receiverContact: string;
}

// --- DATA ---
const initialNotificationsData: Notification[] = [
    { id: 'n1', type: 'payment_received', message: '"Alice J." has sent you a referral payment of ₹1000.', timestamp: Date.now() - 60000 * 5, isRead: false },
    { id: 'n2', type: 'referral', message: 'A new user "Charlie B." has joined your right team.', timestamp: Date.now() - 60000 * 30, isRead: false },
    { id: 'n3', type: 'income', message: 'You have received a matrix income of ₹500 from Level 2.', timestamp: Date.now() - 60000 * 120, isRead: true },
    { id: 'n4', type: 'system', message: 'Welcome to Payback247! Complete your payments to get started.', timestamp: Date.now() - 60000 * 1440, isRead: true },
];

const notificationPool: Omit<Notification, 'id' | 'timestamp' | 'isRead'>[] = [
    { type: 'income', message: 'You just earned a binary income of ₹1000!' },
    { type: 'referral', message: 'New user "Kevin H." was placed in your left team.' },
    { type: 'payment_confirmed', message: 'Your payment for Upline Level 2 has been successfully confirmed.' },
    { type: 'payment_received', message: '"Sarah M." sent you a payment of ₹500 for Matrix Level 1.' },
    { type: 'system', message: 'Reminder: Update your payment receiving details in your profile for faster payouts.' },
];

// Helper function to generate a unique amount for crypto payments
const generateUniqueAmount = (baseAmount: number): number => {
  const uniquePart = Math.random() * 0.009999 + 0.000001;
  return parseFloat((baseAmount + uniquePart).toFixed(6));
};

const initialSystemConfig: SystemConfig = {
    referralAmount: 1000,
    binaryAmount: 1000,
    uplineAmount: 500,
    adminFeeAmount: 500,
};

const initialAdminPaymentOptions: AdminPaymentOption[] = [
    {
        id: 'admin_opt_1',
        name: 'Default Admin Account',
        upiId: 'admin@ybl',
        bankAccount: { name: 'Admin Fee', number: '890123456789', ifsc: 'BANK0000123' },
        usdtAddress: '0xcde456cde456cde456cde456cde456cde456cde',
        qrCodeUrl: null,
        receiverContact: '+91 12345 67897',
    },
    {
        id: 'admin_opt_2',
        name: 'Default Binary Account',
        upiId: 'system-binary@ybl',
        bankAccount: { name: 'System Payments', number: '210987654321', ifsc: 'BANK0004321' },
        usdtAddress: '0x456defgh456defgh456defgh456defgh456defgh',
        qrCodeUrl: null,
        receiverContact: '+91 12345 67891',
    }
];

const generateInitialPayments = (config: SystemConfig, adminOptions: AdminPaymentOption[]): Payment[] => {
    const getQrUrl = (upiId, amount, customUrl) => customUrl || `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=upi://pay?pa=${upiId}&pn=Payment&am=${amount}`;
    
    const getRandomAdminOption = () => {
        if (adminOptions.length === 0) {
            // Fallback if no admin options are configured
            return { id: 'fallback', name: 'Fallback', upiId: 'fallback@upi', bankAccount: { name: 'N/A', number: 'N/A', ifsc: 'N/A' }, usdtAddress: 'N/A', qrCodeUrl: null, receiverContact: 'N/A' };
        }
        return adminOptions[Math.floor(Math.random() * adminOptions.length)];
    };
    
    const binaryOption = getRandomAdminOption();
    const adminOption = getRandomAdminOption();

    return [
        { id: 'pay_ref', title: "1. Referral", amount: config.referralAmount, description: "Payment to your direct sponsor for referring you to the system.", receiverContact: '+91 12345 67890', type: "referral", iconClass: "fa-user-plus", status: 'unpaid', transactionId: '', proof: null, qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=upi://pay?pa=sponsor@ybl&pn=SponsorName&am=${config.referralAmount}`, bankAccount: { name: 'Sponsor Name', number: '123456789012', ifsc: 'BANK0001234' }, upiId: 'sponsor@ybl', usdtAddress: '0x123abcde123abcde123abcde123abcde123abcde', assignedTimestamp: Date.now(), receiverId: 'usr_sponsor', uniqueUsdtAmount: generateUniqueAmount(config.referralAmount) },
        { id: 'pay_bin', title: "2. Binary", amount: config.binaryAmount, description: "Activates your position in the binary income plan.", receiverContact: binaryOption.receiverContact, type: "binary", iconClass: "fa-balance-scale", status: 'unpaid', transactionId: '', proof: null, qrCodeUrl: getQrUrl(binaryOption.upiId, config.binaryAmount, binaryOption.qrCodeUrl), bankAccount: binaryOption.bankAccount, upiId: binaryOption.upiId, usdtAddress: binaryOption.usdtAddress, assignedTimestamp: Date.now(), receiverId: 'system_binary', uniqueUsdtAmount: generateUniqueAmount(config.binaryAmount) },
        ...Array.from({ length: 5 }, (_, i) => ({
            id: `pay_up${i + 1}`,
            title: `${3 + i}. Upline ${i + 1}`,
            amount: config.uplineAmount,
            description: `Payment to your upline sponsor at level ${i + 1} to unlock matrix commissions.`,
            receiverContact: `+91 12345 6789${2+i}`,
            type: `upline${i + 1}`,
            iconClass: "fa-arrow-up",
            status: 'unpaid' as 'unpaid',
            transactionId: '',
            proof: null,
            qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=upi://pay?pa=upline${i+1}@ybl&pn=Upline${i+1}&am=${config.uplineAmount}`,
            bankAccount: { name: `Upline ${i+1}`, number: `${345678901234 + i}`, ifsc: `BANK000567${i}` },
            upiId: `upline${i+1}@ybl`,
            usdtAddress: `0x${(789 + i).toString(16)}ijklm789ijklm789ijklm789ijklm789ijklm`,
            assignedTimestamp: Date.now(),
            receiverId: `usr_0${2 + i}`,
            uniqueUsdtAmount: generateUniqueAmount(config.uplineAmount)
        })),
        { id: 'pay_adm', title: "8. Admin Fee", amount: config.adminFeeAmount, description: "One-time fee for account setup and maintenance.", receiverContact: adminOption.receiverContact, type: "admin", iconClass: "fa-user-shield", status: 'unpaid', transactionId: '', proof: null, qrCodeUrl: getQrUrl(adminOption.upiId, config.adminFeeAmount, adminOption.qrCodeUrl), bankAccount: adminOption.bankAccount, upiId: adminOption.upiId, usdtAddress: adminOption.usdtAddress, assignedTimestamp: Date.now(), receiverId: 'system_admin', uniqueUsdtAmount: generateUniqueAmount(config.adminFeeAmount) },
    ];
};

const initialPendingConfirmationsData: Confirmation[] = [
    { id: 'conf_1', paymentId: 'pay_ref', senderName: 'Alice Johnson', amount: 1000, transactionId: 'TXN789XYZ123', proof: 'https://images.unsplash.com/photo-1593062627473-2178c58a86c3?w=500', date: '2024-02-01 14:30', type: 'Referral Payment', submittedTimestamp: Date.now(), receiverId: 'usr_sponsor', paymentTitle: "1. Referral Payment" },
    { id: 'conf_2', paymentId: 'pay_up1', senderName: 'Bob Williams', amount: 500, transactionId: 'TXN456ABC789', proof: 'https://images.unsplash.com/photo-1593062627473-2178c58a86c3?w=500', date: '2024-02-01 11:15', type: 'Upline Level 1', submittedTimestamp: Date.now(), receiverId: 'usr_02', paymentTitle: "3. Upline Level 1 Payment" },
];

const adminUsersData: AdminUser[] = [
    { id: 'usr_01', name: 'Alice Johnson', profilePicture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=500', joinDate: '2024-02-01', paymentsConfirmed: 8, totalPayments: 8, notes: 'Top performer, potential team leader.', status: 'active', transactions: [ { date: '2024-02-01', type: 'referral', details: 'Initial referral payment', amount: 1000, status: 'confirmed' }, { date: '2024-02-01', type: 'binary', details: 'Binary system activation', amount: 1000, status: 'confirmed' }] },
    { id: 'usr_02', name: 'Bob Williams', profilePicture: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500', joinDate: '2024-02-05', paymentsConfirmed: 5, totalPayments: 8, notes: 'Needs follow-up on remaining payments.', status: 'active', transactions: [ { date: '2024-02-05', type: 'referral', details: 'Initial referral payment', amount: 1000, status: 'confirmed' } ] },
    { id: 'usr_03', name: 'Charlie Brown', profilePicture: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=500', joinDate: '2024-02-10', paymentsConfirmed: 8, totalPayments: 8, notes: '', status: 'active', transactions: [] },
    { id: 'usr_04', name: 'Diana Miller', profilePicture: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=500', joinDate: '2024-02-12', paymentsConfirmed: 2, totalPayments: 8, notes: 'Contacted support on 2024-02-15 regarding payment issue.', status: 'pending', transactions: [] },
    { id: 'usr_05', name: 'Ethan Davis', profilePicture: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=500', joinDate: '2024-02-18', paymentsConfirmed: 8, totalPayments: 8, notes: '', status: 'active', transactions: [] },
    { id: 'usr_06', name: 'Fiona Green', profilePicture: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=500', joinDate: '2024-02-20', paymentsConfirmed: 7, totalPayments: 8, notes: 'Last payment pending since 2024-02-22.', status: 'pending', transactions: [] },
    { id: 'usr_07', name: 'George King', profilePicture: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=500', joinDate: '2024-02-21', paymentsConfirmed: 8, totalPayments: 8, notes: '', status: 'active', transactions: [] },
];

const initialMatrixData = {
    levels: {
        1: { capacity: 2, filled: 2, income: 1000, users: [{ id: 'U001', name: 'John D.', joinTime: '2024-01-10 09:30' }, { id: 'U002', name: 'Sarah M.', joinTime: '2024-01-11 14:20' }] },
        2: { capacity: 4, filled: 3, income: 2000, users: [{ id: 'U003', name: 'Mike R.', joinTime: '2024-01-12 11:15' }, { id: 'U004', name: 'Emma L.', joinTime: '2024-01-13 16:45' }, { id: 'U005', name: 'Alex K.', joinTime: '2024-01-14 10:30' }] },
        3: { capacity: 8, filled: 4, income: 4000, users: [{ id: 'U006', name: 'Lisa P.', joinTime: '2024-01-15 13:20' }, { id: 'U007', name: 'David T.', joinTime: '2024-01-16 15:10' }, { id: 'U008', name: 'Anna S.', joinTime: '2024-01-17 12:05' }, { id: 'U009', name: 'Robert B.', joinTime: '2024-01-18 09:45' }] },
        4: { capacity: 16, filled: 5, income: 8000, users: Array.from({ length: 5 }, (_, i) => ({ id: `U01${i}`, name: `User ${i+1}`, joinTime: '2024-01-19 14:50' })) },
        5: { capacity: 32, filled: 7, income: 16000, users: Array.from({ length: 7 }, (_, i) => ({ id: `U02${i}`, name: `User ${i+6}`, joinTime: '2024-01-20 10:00' })) }
    },
    queue: [
        {id: 'U010', name: 'Maria G.', joinTime: '2024-01-19 14:50', queuePosition: 1},
        {id: 'U011', name: 'Kevin H.', joinTime: '2024-01-19 15:10', queuePosition: 2},
        {id: 'U012', name: 'Linda J.', joinTime: '2024-01-19 15:25', queuePosition: 3},
        {id: 'U013', name: 'Paul W.', joinTime: '2024-01-19 16:00', queuePosition: 4},
        {id: 'U014', name: 'Chris P.', joinTime: '2024-01-20 11:00', queuePosition: 5},
        {id: 'U015', name: 'Nancy R.', joinTime: '2024-01-20 12:30', queuePosition: 6},
        {id: 'U016', name: 'George K.', joinTime: '2024-01-20 13:00', queuePosition: 7},
        {id: 'U017', name: 'Helen Z.', joinTime: '2024-01-20 14:15', queuePosition: 8},
    ],
    incomeHistory: [
        { date: '2024-01-15 10:30', from: 'User A', level: 1, amount: 500, status: 'paid' },
        { date: '2024-01-12 16:45', from: 'User E', level: 2, amount: 500, status: 'paid' },
        { date: '2024-01-11 11:30', from: 'User F', level: 3, amount: 500, status: 'verified' }
    ],
    commissionPerLevel: 500
};

const initialBinaryData = {
    leftTeam: ['User B', 'User X', 'User L1', 'User L2', 'User L3', 'User L4', 'User L5'], // 7 members
    rightTeam: ['User C', 'User Y', 'User R1', 'User R2', 'User R3', 'User R4'], // 6 members
    matchedPairs: [
        {
            pairNumber: 1,
            leftUsers: ['User B', 'User X', 'User L1'],
            rightUsers: ['User C', 'User Y', 'User R1'],
            date: '2024-01-14 14:20',
            amount: 1000,
            status: 'paid' as 'paid'
        },
    ],
    pendingPairs: [
        {
            pairNumber: 2,
            leftUsers: ['User L2', 'User L3', 'User L4'],
            rightUsers: ['User R2', 'User R3', 'User R4'],
            date: '2024-02-10 18:00',
            amount: 1000,
            status: 'pending' as 'pending'
        }
    ],
    currentUserPosition: 12,
    matchingQueue: [
        { id: 'bq_1', name: 'Kevin H.', profilePicture: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=500', joinTime: '2024-02-21 10:00', queuePosition: 1, isQualified: false },
        { id: 'bq_2', name: 'Linda J.', profilePicture: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=500', joinTime: '2024-02-21 11:15', queuePosition: 2, isQualified: true },
        { id: 'bq_3', name: 'Paul W.', profilePicture: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=500', joinTime: '2024-02-21 12:30', queuePosition: 3, isQualified: true },
        { id: 'bq_4', name: 'Chris P.', profilePicture: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=500', joinTime: '2024-02-21 14:00', queuePosition: 4, isQualified: false },
        { id: 'bq_6', name: 'Nancy R.', profilePicture: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=500', joinTime: '2024-02-22 09:00', queuePosition: 5, isQualified: true },
        { id: 'bq_7', name: 'George K.', profilePicture: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500', joinTime: '2024-02-22 10:20', queuePosition: 6, isQualified: true },
        { id: 'bq_8', name: 'Helen Z.', profilePicture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=500', joinTime: '2024-02-22 11:00', queuePosition: 7, isQualified: false },
        { id: 'bq_9', name: 'Mark T.', profilePicture: 'https://images.unsplash.com/photo-1557862921-37829c790f19?w=500', joinTime: '2024-02-22 12:15', queuePosition: 8, isQualified: true },
        { id: 'bq_10', name: 'Susan B.', profilePicture: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=500', joinTime: '2024-02-22 13:30', queuePosition: 9, isQualified: false },
        { id: 'bq_11', name: 'Richard M.', profilePicture: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=500', joinTime: '2024-02-22 14:45', queuePosition: 10, isQualified: true },
        { id: 'bq_12', name: 'Karen L.', profilePicture: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=500', joinTime: '2024-02-22 16:00', queuePosition: 11, isQualified: true },
        { id: 'bq_5', name: 'John Doe', profilePicture: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=500', joinTime: '2024-02-22 17:15', queuePosition: 12, isQualified: false }, // This is the current user
        { id: 'bq_13', name: 'Steven H.', profilePicture: 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=500', joinTime: '2024-02-23 09:00', queuePosition: 13, isQualified: true },
        { id: 'bq_14', name: 'Laura P.', profilePicture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500', joinTime: '2024-02-23 10:30', queuePosition: 14, isQualified: false },
        { id: 'bq_15', name: 'Daniel G.', profilePicture: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=500', joinTime: '2024-02-23 11:45', queuePosition: 15, isQualified: true },
    ].map((user, index) => ({ ...user, queuePosition: index + 1 }))
};


const initialSponsorData = {
    directs: [
        { date: '2024-01-05 11:30', name: 'User A', position: 'right', amount: 1000, status: 'pending' },
        { date: '2023-12-28 14:20', name: 'User B', position: 'left', amount: 1000, status: 'paid' },
        { date: '2024-01-13 09:15', name: 'User D', position: 'left', amount: 1000, status: 'pending' },
    ]
};

const initialTransactionsData = [
    { date: '2024-01-15 10:30', type: 'matrix', details: 'Level-01-0-15 from User A', amount: 500, status: 'paid' },
    { date: '2024-01-14 14:20', type: 'sponsor', details: 'Level 1 User B, Right User C', amount: 500, status: 'paid' },
    { date: '2024-01-13 09:15', type: 'binary', details: 'Left: User B, Right: User C', amount: 1000, status: 'paid' },
    { date: '2024-01-12 16:45', type: 'binary', details: 'Direct referral: User D', amount: 1000, status: 'paid' },
    { date: '2024-01-11 11:30', type: 'sponsor', details: 'Direct referral: from User E', amount: 500, status: 'paid' },
    { date: '2024-01-10 11:30', type: 'matrix', details: 'Level 2 User B from User E', amount: 500, status: 'paid' },
    { date: '2024-01-09 11:30', type: 'matrix', details: 'Level 3 User from User F', amount: 500, status: 'paid' },
    { date: '2024-01-08 11:30', type: 'binary', details: 'Leftt: User X, Right: User Y', amount: 500, status: 'paid' },

];

const defaultProfileData = {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+1 234 567 890',
    joinDate: '2024-01-01',
    profilePicture: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=880&q=80',
    notifications: {
        email: true,
        push: false,
    },
    paymentDetails: {
        accountHolder: 'John Doe',
        accountNumber: '123456789012',
        bankName: 'Example Bank',
        ifsc: 'EXAM0001234',
        upiId: 'john.doe@upi',
        usdtAddress: '0x123abcde123abcde123abcde123abcde123abcde',
        upiQRCode: null,
    }
};

const ALL_TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-tachometer-alt' },
    { id: 'join', label: 'Join', icon: 'fa-qrcode' },
    { id: 'confirmations', label: 'Confirm', icon: 'fa-check-circle' },
    { id: 'matrix', label: 'Matrix', icon: 'fa-sitemap' },
    { id: 'binary', label: 'Binary', icon: 'fa-balance-scale' },
    { id: 'sponsor', label: 'Sponsor', icon: 'fa-users' },
    { id: 'transactions', label: 'History', icon: 'fa-exchange-alt' },
    { id: 'profile', label: 'Profile', icon: 'fa-user-circle' },
    { id: 'disputes', label: 'Disputes', icon: 'fa-gavel', admin: true },
    { id: 'admin', label: 'Admin', icon: 'fa-user-cog', admin: true },
    { id: 'config', label: 'System Config', icon: 'fa-cogs', admin: true },
];

// --- LOCAL STORAGE PERSISTENCE ---
const APP_STATE_KEY = 'payback247_app_state';

const getInitialState = () => {
    try {
        const savedState = localStorage.getItem(APP_STATE_KEY);
        if (savedState) {
            const parsedState = JSON.parse(savedState);
            // Basic check to ensure it's not empty or malformed
            if (parsedState.profile && parsedState.paymentsData) {
                return parsedState;
            }
        }
    } catch (error) {
        console.error("Failed to parse state from localStorage", error);
    }

    // If nothing is saved, generate fresh initial data
    const config = initialSystemConfig;
    const options = initialAdminPaymentOptions;
    return {
        activeTab: 'dashboard',
        systemConfig: config,
        adminPaymentOptions: options,
        paymentsData: generateInitialPayments(config, options),
        pendingConfirmations: initialPendingConfirmationsData,
        transactionsData: initialTransactionsData,
        isAdmin: false,
        allUsers: adminUsersData,
        disputes: [],
        isSidebarOpen: window.innerWidth > 1024,
        notifications: initialNotificationsData,
        binaryData: initialBinaryData,
        sponsorData: initialSponsorData,
        profile: defaultProfileData,
    };
};

// --- HELPER COMPONENTS ---

const StatusBadge = ({ status }: { status: string }) => {
    const statusLower = status.toLowerCase();
    const statusInfo: { [key: string]: { style: string; text: string } } = {
        pending: { style: 'bg-yellow-100 text-yellow-800', text: 'Pending' },
        paid: { style: 'bg-green-100 text-green-800', text: 'Paid' },
        verified: { style: 'bg-blue-100 text-blue-800', text: 'Verified' },
        confirmed: { style: 'bg-green-100 text-green-800', text: 'Confirmed' },
        unpaid: { style: 'bg-red-100 text-red-800', text: 'Unpaid' },
        expired: { style: 'bg-gray-100 text-gray-500', text: 'Expired' },
        active: { style: 'bg-green-100 text-green-800', text: 'Active' },
        verifying: { style: 'bg-indigo-100 text-indigo-800 animate-pulse', text: 'Verifying' },
        failed: { style: 'bg-red-200 text-red-900', text: 'Verification Failed' },
        disputed: { style: 'bg-orange-100 text-orange-800', text: 'In Dispute' },
        on_hold: { style: 'bg-orange-100 text-orange-800', text: 'On Hold' },
    };

    const currentStatus = statusInfo[statusLower] || { style: 'bg-gray-100 text-gray-800', text: status };

    return <span className={`px-3 py-1 text-xs font-bold rounded-full ${currentStatus.style}`}>{currentStatus.text.toUpperCase()}</span>;
};

const IncomeTypeBadge = ({ type }: { type: string }) => {
    const styles = {
        sponsor: 'bg-red-100 text-red-800',
        binary: 'bg-blue-100 text-blue-800',
        matrix: 'bg-green-100 text-green-800',
        referral: 'bg-purple-100 text-purple-800',
        crypto: 'bg-yellow-100 text-yellow-800',
    };
    return <span className={`px-3 py-1 text-xs font-bold rounded-full ${styles[type]}`}>{type.toUpperCase()}</span>;
};

interface ConfirmationDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmButtonText?: string;
    confirmButtonClass?: string;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ isOpen, onClose, onConfirm, title, message, confirmButtonText = 'Confirm', confirmButtonClass = 'btn-outline-primary' }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="card w-full max-w-md animate-scaleIn">
                <h2 className="text-xl font-bold mb-4 text-center">{title}</h2>
                <div className="bg-gray-50/70 p-4 my-6 rounded-lg text-center">
                    <p className="text-gray-600">{message}</p>
                </div>
                <div className="flex justify-center gap-4">
                    <button onClick={onClose} className="btn btn-secondary w-28">Cancel</button>
                    <button onClick={onConfirm} className={`btn ${confirmButtonClass} w-28`}>{confirmButtonText}</button>
                </div>
            </div>
        </div>
    );
};

const PaginationControls = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center justify-start gap-4 mt-4 pt-4 border-t">
            <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="btn btn-secondary !p-0 w-10 h-10 flex items-center justify-center rounded-full"
                aria-label="Go to previous page"
            >
                <i className="fas fa-chevron-left"></i>
            </button>

            <span className="font-semibold text-sm text-gray-700 tabular-nums">
                Page {currentPage} / {totalPages}
            </span>

            <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="btn btn-secondary !p-0 w-10 h-10 flex items-center justify-center rounded-full"
                aria-label="Go to next page"
            >
                <i className="fas fa-chevron-right"></i>
            </button>
        </div>
    );
};


// --- TAB CONTENT COMPONENTS ---

// Fix: Add type definitions to resolve TypeScript error.
interface User {
    id: string;
    name: string;
    joinTime: string;
}

interface MatrixLevel {
    capacity: number;
    filled: number;
    income: number;
    users: User[];
}

interface MatrixData {
    levels: Record<number, MatrixLevel>;
    queue: { id: string; name: string; joinTime: string; queuePosition: number }[];
    incomeHistory: { date: string; from: string; level: number; amount: number; status: string }[];
    commissionPerLevel: number;
}

interface MatchedPair {
    pairNumber: number;
    leftUsers: string[];
    rightUsers: string[];
    date: string;
    amount: number;
    status: 'paid' | 'pending';
}

interface BinaryData {
    leftTeam: string[];
    rightTeam: string[];
    matchedPairs: MatchedPair[];
    pendingPairs: MatchedPair[];
    matchingQueue: {
        id: string;
        name: string;
        profilePicture: string;
        joinTime: string;
        queuePosition: number;
        isQualified: boolean;
    }[];
    currentUserPosition: number;
}


interface SponsorData {
    directs: { date: string; name: string; position: string; amount: number; status: string }[];
}


interface DashboardTabProps {
    matrixData: MatrixData;
    binaryData: BinaryData;
    sponsorData: SponsorData;
    onTabChange: (tabId: string) => void;
    isAccountActive: boolean;
    isQualifiedForBinary: boolean;
}


const DashboardTab = ({ matrixData, binaryData, sponsorData, onTabChange, isAccountActive, isQualifiedForBinary }: DashboardTabProps) => {
    const totalMatrixIncome = Object.values(matrixData.levels).reduce((sum, level) => sum + level.income, 0);
    const totalSponsorIncome = sponsorData.directs.filter(i => i.status === 'paid').reduce((sum, inc) => sum + inc.amount, 0);
    const totalBinaryIncome = isQualifiedForBinary ? binaryData.matchedPairs.reduce((sum, pair) => sum + pair.amount, 0) : 0;
    const totalIncome = totalMatrixIncome + totalSponsorIncome + totalBinaryIncome;

    const totalMatrixUsersCapacity = Object.values(matrixData.levels).reduce((sum, level) => sum + level.capacity, 0);
    const totalCommissionPotential = totalMatrixUsersCapacity * matrixData.commissionPerLevel;

    const [copiedLink, setCopiedLink] = React.useState('');
    const leftLink = 'https://payback247.com/join?ref=JD123&pos=left';
    const rightLink = 'https://payback247.com/join?ref=JD123&pos=right';

    const handleCopyLink = (link: string) => {
        navigator.clipboard.writeText(link);
        setCopiedLink(link);
        setTimeout(() => setCopiedLink(''), 2000);
    };

    const handleShare = (platform: 'whatsapp' | 'facebook' | 'twitter' | 'telegram', link: string) => {
        const message = `Join me on Payback247! Use my link to get started:`;
        const encodedLink = encodeURIComponent(link);
        const encodedMessage = encodeURIComponent(`${message} ${link}`);
        const encodedText = encodeURIComponent(message);

        let url = '';
        switch (platform) {
            case 'whatsapp':
                url = `https://api.whatsapp.com/send?text=${encodedMessage}`;
                break;
            case 'facebook':
                url = `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`;
                break;
            case 'twitter':
                url = `https://twitter.com/intent/tweet?url=${encodedLink}&text=${encodedText}`;
                break;
            case 'telegram':
                url = `https://t.me/share/url?url=${encodedLink}&text=${encodedText}`;
                break;
            default:
                return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const socialPlatforms = [
        { name: 'whatsapp', icon: 'fa-whatsapp', color: 'hover:bg-green-500' },
        { name: 'facebook', icon: 'fa-facebook-f', color: 'hover:bg-blue-800' },
        { name: 'twitter', icon: 'fa-twitter', color: 'hover:bg-sky-500' },
        { name: 'telegram', icon: 'fa-telegram-plane', color: 'hover:bg-blue-500' },
    ];


    return (
        <div className="space-y-8">
            <section>
                 <div className={`p-4 rounded-xl mb-6 text-center text-white font-bold ${isAccountActive ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}>
                    {isAccountActive 
                        ? <><i className="fas fa-check-circle mr-2"></i> Your account is active and ready to receive payments!</>
                        : <><i className="fas fa-exclamation-triangle mr-2"></i> Your account is pending activation. Please complete all payments in the "Join System" tab.</>
                    }
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="p-6 rounded-2xl shadow-lg bg-white flex justify-between items-center transition-all duration-300 hover:-translate-y-1">
                        <div>
                            <div className="text-sm text-gray-500 font-bold">Total Income</div>
                            <div className="text-3xl font-bold text-gray-800">₹32,000</div>
                        </div>
                        <i className="fas fa-money-bill-wave text-4xl text-green-200"></i>
                    </div>
                     <div className="p-6 rounded-2xl shadow-lg bg-white flex justify-between items-center transition-all duration-300 hover:-translate-y-1">
                        <div>
                            <div className="text-sm text-gray-500 font-bold">Sponsor Income</div>
                            <div className="text-3xl font-bold text-gray-800">₹1,000</div>
                        </div>
                        <i className="fas fa-users text-4xl text-red-200"></i>
                    </div>
                     <div className="p-6 rounded-2xl shadow-lg bg-white flex justify-between items-center transition-all duration-300 hover:-translate-y-1">
                        <div>
                            <div className="text-sm text-gray-500 font-bold">Binary Income</div>
                            <div className="text-3xl font-bold text-gray-800">₹0</div>
                        </div>
                        <i className="fas fa-balance-scale text-4xl text-blue-200"></i>
                    </div>
                     <div className="p-6 rounded-2xl shadow-lg bg-white flex justify-between items-center transition-all duration-300 hover:-translate-y-1">
                        <div>
                            <div className="text-sm text-gray-500 font-bold">Matrix Income</div>
                            <div className="text-3xl font-bold text-gray-800">₹31,000</div>
                        </div>
                        <i className="fas fa-sitemap text-4xl text-purple-200"></i>
                    </div>
                </div>
            </section>
            
            <section className="card bg-gradient-to-tr from-blue-50 to-indigo-100 text-gray-800 shadow-xl">
                <h2 className="text-2xl font-bold text-center mb-2"><i className="fas fa-rocket mr-2 text-[var(--primary)]"></i> Grow Your Network</h2>
                <p className="text-center text-sm text-gray-600 mb-8 max-w-xl mx-auto">Share these links to grow your teams. New members will be automatically placed under you.</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left Team Block */}
                    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                        <h3 className="font-bold text-lg mb-4 text-center text-gray-700">Invite to your LEFT Team</h3>
                        <div className="flex items-center gap-2">
                            <input type="text" readOnly value={leftLink} className="input-field !mt-0" />
                            <button onClick={() => handleCopyLink(leftLink)} className="btn btn-secondary flex-shrink-0 w-28">
                                {copiedLink === leftLink ? <><i className="fas fa-check mr-2"></i>Copied</> : <><i className="fas fa-copy mr-2"></i>Copy</>}
                            </button>
                        </div>
                        <div className="flex justify-center items-center gap-3 mt-4">
                            <p className="text-sm font-semibold text-gray-600">Share via:</p>
                            {socialPlatforms.map(p => (
                                <button key={p.name} onClick={() => handleShare(p.name as any, leftLink)} title={`Share on ${p.name.charAt(0).toUpperCase() + p.name.slice(1)}`} className={`w-9 h-9 flex items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors ${p.color} hover:text-white`}>
                                    <i className={`fab ${p.icon}`}></i>
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* Right Team Block */}
                    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                        <h3 className="font-bold text-lg mb-4 text-center text-gray-700">Invite to your RIGHT Team</h3>
                        <div className="flex items-center gap-2">
                            <input type="text" readOnly value={rightLink} className="input-field !mt-0" />
                            <button onClick={() => handleCopyLink(rightLink)} className="btn btn-secondary flex-shrink-0 w-28">
                                {copiedLink === rightLink ? <><i className="fas fa-check mr-2"></i>Copied</> : <><i className="fas fa-copy mr-2"></i>Copy</>}
                            </button>
                        </div>
                         <div className="flex justify-center items-center gap-3 mt-4">
                            <p className="text-sm font-semibold text-gray-600">Share via:</p>
                            {socialPlatforms.map(p => (
                                <button key={p.name} onClick={() => handleShare(p.name as any, rightLink)} title={`Share on ${p.name.charAt(0).toUpperCase() + p.name.slice(1)}`} className={`w-9 h-9 flex items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors ${p.color} hover:text-white`}>
                                    <i className={`fab ${p.icon}`}></i>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className="card">
                <h2 className="text-2xl font-bold text-center mb-4 text-[var(--primary)]"><i className="fas fa-cogs mr-2"></i> Key System Features</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <i className="fas fa-users-cog text-2xl text-blue-500 mb-2"></i>
                        <h3 className="font-bold">Auto Placement</h3>
                        <p className="text-sm text-gray-600">First-in, first-out system ensures fair placement in both Binary and Matrix structures.</p>
                    </div>
                    <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                        <i className="fas fa-project-diagram text-2xl text-purple-500 mb-2"></i>
                        <h3 className="font-bold">Forced Matrix Spillover</h3>
                        <p className="text-sm text-gray-600">Your matrix fills from upline and downline efforts, maximizing team growth and potential earnings.</p>
                    </div>
                </div>
            </section>

            <section className="card">
                <h2 className="text-2xl font-bold text-center mb-4 text-[var(--primary)]"><i className="fas fa-layer-group mr-2"></i> Matrix Level Potential</h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                    {[1000, 2000, 4000, 8000, 16000].map((income, index) => {
                        const level = index + 1;
                        return (
                             <div key={level} className="bg-gray-50 text-gray-800 p-4 rounded-xl shadow-md transition-transform duration-300 hover:-translate-y-1">
                                <div className="font-bold text-lg text-[var(--primary)]">Level {level}</div>
                                <div className="text-2xl font-bold text-green-600 my-1">₹{income.toLocaleString()}</div>
                                <div className="text-xs text-gray-500">Potential Income</div>
                            </div>
                        );
                    })}
                </div>
                 <div className="mt-6 bg-gray-50 text-gray-800 p-4 rounded-xl text-center border-2 border-yellow-400">
                    <h3 className="font-bold">Total Matrix Commission Potential</h3>
                    <div className="text-3xl font-bold text-red-600 my-1">₹{totalCommissionPotential.toLocaleString()}</div>
                    <p className="text-sm">From a complete 2x5 matrix structure.</p>
                </div>
            </section>
        </div>
    );
};

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    payment: Payment | null;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, payment }) => {
    if (!isOpen || !payment) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="card w-full max-w-md animate-scaleIn">
                <h2 className="text-xl font-bold mb-4 text-center">Confirm Payment Details</h2>
                <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
                    <p><strong>Payment for:</strong> {payment.title}</p>
                    <p><strong>Amount:</strong> ₹{payment.amount.toLocaleString()}</p>
                    <p><strong>Transaction ID:</strong> <span className="font-mono text-[var(--primary)]">{payment.transactionId}</span></p>
                    <p><strong>Payment Proof:</strong> {payment.proof ? 'File attached' : 'No file'}</p>
                </div>
                <p className="text-sm text-gray-500 my-4 text-center">Please ensure all details are correct before submitting. This action cannot be undone.</p>
                <div className="flex justify-end gap-3 mt-4">
                    <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                    <button onClick={onConfirm} className="btn btn-primary">Confirm & Submit</button>
                </div>
            </div>
        </div>
    );
};

const CountdownTimer: React.FC<{ expiryTimestamp: number }> = ({ expiryTimestamp }) => {
    const [timeLeft, setTimeLeft] = useState(expiryTimestamp - Date.now());

    useEffect(() => {
        const timer = setInterval(() => {
            const remaining = expiryTimestamp - Date.now();
            setTimeLeft(remaining > 0 ? remaining : 0);
            if (remaining <= 0) {
                clearInterval(timer);
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [expiryTimestamp]);
    
    const hours = Math.floor((timeLeft / (1000 * 60 * 60)));
    const minutes = Math.floor((timeLeft / 1000 / 60) % 60);
    const seconds = Math.floor((timeLeft / 1000) % 60);

    return (
        <div className="text-center font-mono text-2xl font-bold text-red-600 p-2 bg-red-50 border-2 border-red-200 rounded-lg">
            {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>
    );
};


interface PaymentCardProps {
    payment: Payment;
    onUpdate: (id: string, field: 'transactionId' | 'proof', value: string) => void;
    onSubmit: (payment: Payment) => void;
    onAutoVerify: (payment: Payment) => void;
}

const PaymentCard: React.FC<PaymentCardProps> = ({ payment, onUpdate, onSubmit, onAutoVerify }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [activeMethod, setActiveMethod] = useState('qr');
    const [copiedValue, setCopiedValue] = useState('');

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                onUpdate(payment.id, 'proof', event.target?.result as string);
                setFileName(file.name);
            };
            reader.readAsDataURL(file);
        }
    };
    
    useEffect(() => {
        if (payment.status === 'unpaid') {
            setFileName(null);
        }
    }, [payment.status]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedValue(text);
        setTimeout(() => setCopiedValue(''), 2000); // Reset after 2 seconds
    };
    
    const isCrypto = activeMethod === 'crypto';
    const canSubmit = isCrypto ? !!payment.transactionId : (!!payment.transactionId && !!payment.proof);


    const PaymentMethodButton = ({ method, icon, label }: { method: string, icon: string, label: string }) => (
        <button
            onClick={() => setActiveMethod(method)}
            className={`flex-1 p-2 text-sm font-semibold rounded-md transition-colors ${
                activeMethod === method ? 'bg-[var(--primary)] text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
        >
            <i className={`fas ${icon} mr-2`}></i>{label}
        </button>
    );

    const DetailRow = ({ label, value }: { label: string, value: string }) => (
        <div className="flex justify-between items-center py-2 border-b">
            <div>
                <p className="text-xs text-gray-500">{label}</p>
                <p className="font-mono text-sm break-all">{value}</p>
            </div>
            <button onClick={() => copyToClipboard(value)} className="btn btn-secondary !py-1 !px-2 text-xs">
                {copiedValue === value ? <><i className="fas fa-check mr-1"></i>Copied</> : <><i className="fas fa-copy mr-1"></i>Copy</>}
            </button>
        </div>
    );
    
    return (
        <div className={`transition-all duration-300 ${payment.status === 'confirmed' ? 'bg-green-50' : ''} ${payment.status === 'expired' ? 'bg-gray-50 opacity-70' : ''} ${payment.status === 'disputed' ? 'bg-orange-50' : ''}`}>
            <p className="text-sm text-gray-500 mb-4">{payment.description}</p>
            
            {payment.status === 'unpaid' && (
                <div className="space-y-4">
                     {payment.assignedTimestamp && payment.type !== 'admin' && (
                        <div className="mb-4">
                            <p className="text-center text-sm font-semibold text-gray-700 mb-2">Time remaining to complete payment:</p>
                            <CountdownTimer expiryTimestamp={payment.assignedTimestamp + PAYMENT_TIMER_DURATION} />
                        </div>
                    )}
                    <div className="bg-gray-100 p-3 rounded-lg">
                        <div className="flex gap-2 mb-3">
                           <PaymentMethodButton method="qr" icon="fa-qrcode" label="QR Code" />
                           <PaymentMethodButton method="bank" icon="fa-university" label="Bank" />
                           <PaymentMethodButton method="upi" icon="fa-mobile-alt" label="UPI" />
                           <PaymentMethodButton method="crypto" icon="fa-coins" label="Crypto" />
                        </div>
                        <div className="p-2 min-h-[180px]">
                            {activeMethod === 'qr' && (
                                <div className="text-center animate-fadeIn">
                                    <img src={payment.qrCodeUrl} alt="QR Code to pay" className="mx-auto rounded-lg shadow-md mb-2" width="150" height="150" />
                                    <p className="text-sm text-gray-600">Scan using any UPI app</p>
                                </div>
                            )}
                             {activeMethod === 'bank' && (
                                <div className="space-y-2 animate-fadeIn">
                                    <DetailRow label="Account Name" value={payment.bankAccount.name} />
                                    <DetailRow label="Account Number" value={payment.bankAccount.number} />
                                    <DetailRow label="IFSC Code" value={payment.bankAccount.ifsc} />
                                </div>
                            )}
                             {activeMethod === 'upi' && (
                                <div className="space-y-2 animate-fadeIn">
                                    <DetailRow label="UPI ID" value={payment.upiId} />
                                    <p className="text-center text-xs text-gray-500 pt-4">Enter this UPI ID in your payment app.</p>
                                </div>
                            )}
                            {activeMethod === 'crypto' && (
                                <div className="space-y-2 animate-fadeIn">
                                    <div className="text-center p-3 bg-yellow-50 border-2 border-yellow-200 rounded-lg">
                                        <p className="text-xs text-yellow-800 font-semibold">To prevent fraud, please send this EXACT amount:</p>
                                        <div className="flex justify-between items-center py-2">
                                            <p className="font-mono text-lg font-bold text-gray-800 break-all">{payment.uniqueUsdtAmount?.toFixed(6)} USDT</p>
                                            <button onClick={() => copyToClipboard(String(payment.uniqueUsdtAmount))} className="btn btn-secondary !py-1 !px-2 text-xs">
                                                {copiedValue === String(payment.uniqueUsdtAmount) ? <><i className="fas fa-check mr-1"></i>Copied</> : <><i className="fas fa-copy mr-1"></i>Copy</>}
                                            </button>
                                        </div>
                                    </div>
                                    <DetailRow label="USDT Address (BEP20)" value={payment.usdtAddress} />
                                    <p className="text-center text-xs text-gray-500 pt-2">Ensure you are sending via the BEP20 network.</p>
                                </div>
                            )}
                        </div>
                         <div className="border-t mt-3 pt-3 text-center">
                            <p className="text-sm font-bold flex items-center justify-center gap-2"><i className="fas fa-phone-alt text-gray-500"></i> Receiver Contact:</p>
                            <p className="text-sm font-semibold text-gray-800 font-mono">{payment.receiverContact}</p>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="font-semibold text-sm">{isCrypto ? 'Transaction Hash (TxHash)' : 'Transaction ID'}</label>
                            <input
                                type="text"
                                className="input-field"
                                placeholder={isCrypto ? 'e.g., 0x...' : 'Enter your transaction ID'}
                                value={payment.transactionId}
                                onChange={(e) => onUpdate(payment.id, 'transactionId', e.target.value)}
                            />
                        </div>
                        {!isCrypto && (
                             <div>
                                <label className="font-semibold text-sm">Upload Payment Proof</label>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    onChange={handleFileChange}
                                    accept="image/*"
                                />
                                <button onClick={() => fileInputRef.current?.click()} className="mt-1 w-full text-left p-3 border border-gray-300 rounded-lg shadow-sm bg-gray-50 hover:bg-gray-100 transition-colors">
                                    <i className="fas fa-upload mr-2 text-gray-500"></i>
                                    {fileName || 'Click to select a file'}
                                </button>
                            </div>
                        )}
                        <button
                            className="btn btn-primary w-full"
                            onClick={() => isCrypto ? onAutoVerify(payment) : onSubmit(payment)}
                            disabled={!canSubmit}
                        >
                           {isCrypto ?
                                <><i className="fas fa-check-double mr-2"></i> Submit & Auto-Verify</> :
                                <><i className="fas fa-paper-plane mr-2"></i> Submit for Verification</>
                            }
                        </button>
                    </div>
                </div>
            )}

            {payment.status === 'pending' && (
                <div className="text-center bg-yellow-50 p-4 rounded-lg">
                    <i className="fas fa-hourglass-half text-yellow-500 text-2xl mb-2"></i>
                    <p className="font-bold">Awaiting Confirmation</p>
                    <p className="text-sm text-gray-600">Your payment has been submitted and is waiting for the receiver to confirm.</p>
                </div>
            )}
            
             {payment.status === 'verifying' && (
                <div className="text-center bg-indigo-50 p-4 rounded-lg">
                    <i className="fas fa-spinner fa-spin text-indigo-500 text-2xl mb-2"></i>
                    <p className="font-bold">Verifying on Blockchain</p>
                    <p className="text-sm text-gray-600">This may take a moment. Please do not close this page.</p>
                </div>
            )}

             {payment.status === 'failed' && (
                <div className="text-center bg-red-100 p-4 rounded-lg">
                    <i className="fas fa-exclamation-triangle text-red-500 text-2xl mb-2"></i>
                    <p className="font-bold">Verification Failed</p>
                    <p className="text-sm text-gray-600">The transaction hash could not be verified. The form will reset shortly.</p>
                </div>
            )}

            {payment.status === 'confirmed' && (
                <div className="text-center bg-green-50 p-4 rounded-lg">
                     <i className="fas fa-check-circle text-green-500 text-2xl mb-2"></i>
                    <p className="font-bold">Payment Confirmed</p>
                    <p className="text-sm text-gray-600">This payment has been successfully verified.</p>
                </div>
            )}
            
            {payment.status === 'expired' && (
                <div className="text-center bg-gray-100 p-4 rounded-lg">
                    <i className="fas fa-times-circle text-red-500 text-2xl mb-2"></i>
                    <p className="font-bold">Payment Time Expired</p>
                    <p className="text-sm text-gray-600">This payment opportunity has been assigned to another user.</p>
                </div>
            )}

            {payment.status === 'disputed' && (
                <div className="text-center bg-orange-50 p-4 rounded-lg">
                    <i className="fas fa-gavel text-orange-500 text-2xl mb-2"></i>
                    <p className="font-bold">Payment in Dispute</p>
                    <p className="text-sm text-gray-600">The receiver did not confirm in time. An admin is reviewing this payment.</p>
                </div>
            )}
        </div>
    );
};

interface JoinTabProps {
    payments: Payment[];
    onUpdatePayment: (id: string, field: 'transactionId' | 'proof', value: string) => void;
    onSubmitPayment: (payment: Payment) => void;
    onAutoVerify: (payment: Payment) => void;
}

const JoinTab = ({ payments, onUpdatePayment, onSubmitPayment, onAutoVerify }: JoinTabProps) => {
    const [modalPayment, setModalPayment] = useState<Payment | null>(null);
    const [activePaymentId, setActivePaymentId] = useState<string | null>(null);

    useEffect(() => {
        // Set the initial active tab to the first unconfirmed payment.
        const firstUnconfirmed = payments.find(p => p.status !== 'confirmed');
        if (firstUnconfirmed) {
            setActivePaymentId(firstUnconfirmed.id);
        } else {
            // If all are confirmed, collapse all.
            setActivePaymentId(null);
        }
    }, [payments]);

    const confirmedCount = payments.filter(p => p.status === 'confirmed').length;
    const progress = (confirmedCount / payments.length) * 100;

    const handleSubmitClick = (payment: Payment) => {
        setModalPayment(payment);
    };

    const handleConfirmSubmit = () => {
        if (modalPayment) {
            onSubmitPayment(modalPayment);
            setModalPayment(null);
        }
    };

    const getStatusIconClasses = (status: Payment['status']) => {
        switch (status) {
            case 'confirmed': return 'bg-green-100 text-green-700';
            case 'pending':
            case 'verifying': return 'bg-yellow-100 text-yellow-800';
            case 'disputed': return 'bg-orange-100 text-orange-800';
            default: return 'bg-gray-200 text-gray-600';
        }
    };
    
    return (
        <div className="space-y-6">
            <div className="card">
                <h2 className="text-xl font-bold mb-2">Activation Progress</h2>
                <p className="text-sm text-gray-600 mb-4">You must complete and confirm all payments below to activate your account.</p>
                <div className="w-full bg-gray-200 rounded-full h-4">
                    <div 
                        className="bg-green-500 h-4 rounded-full transition-all duration-500" 
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
                <p className="text-right font-bold mt-2">{confirmedCount} of {payments.length} Payments Confirmed</p>
            </div>
            
            <div className="space-y-4">
                {payments.map(payment => {
                    const isActive = activePaymentId === payment.id;
                    return (
                        <div key={payment.id} className="card p-0 overflow-hidden transition-shadow hover:shadow-md">
                            <button
                                onClick={() => setActivePaymentId(isActive ? null : payment.id)}
                                className="flex justify-between items-center w-full p-4 text-left"
                                aria-expanded={isActive}
                                aria-controls={`payment-details-${payment.id}`}
                            >
                                <div className="flex items-center gap-4">
                                     <div className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold flex-shrink-0 transition-colors ${getStatusIconClasses(payment.status)}`}>
                                        {payment.status === 'confirmed' ? (
                                            <i className="fas fa-check"></i>
                                        ) : (
                                            <span>{payment.title.split('.')[0]}</span>
                                        )}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-gray-800">{payment.title}</h3>
                                        <p className="text-sm text-gray-500">Amount: ₹{payment.amount.toLocaleString()}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 ml-4">
                                    <div className="hidden sm:block">
                                        <StatusBadge status={payment.status} />
                                    </div>
                                    <i className={`fas fa-chevron-down text-gray-400 transition-transform duration-300 ${isActive ? 'rotate-180' : ''}`}></i>
                                </div>
                            </button>
                            {isActive && (
                                <div id={`payment-details-${payment.id}`} className="p-4 sm:p-6 border-t border-gray-100 animate-fadeIn">
                                    <PaymentCard
                                        key={payment.id}
                                        payment={payment}
                                        onUpdate={onUpdatePayment}
                                        onSubmit={handleSubmitClick}
                                        onAutoVerify={onAutoVerify}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <ConfirmationModal
                isOpen={!!modalPayment}
                onClose={() => setModalPayment(null)}
                onConfirm={handleConfirmSubmit}
                payment={modalPayment}
            />
        </div>
    );
};

interface ProofModalProps {
    isOpen: boolean;
    onClose: () => void;
    proofUrl: string | null;
}

const ProofModal: React.FC<ProofModalProps> = ({ isOpen, onClose, proofUrl }) => {
    if (!isOpen || !proofUrl) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50" onClick={onClose}>
            <div className="relative max-w-3xl w-full p-4 animate-scaleIn" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute -top-4 -right-4 bg-white rounded-full h-10 w-10 text-black flex items-center justify-center text-xl z-10">&times;</button>
                <img src={proofUrl} alt="Payment Proof" className="max-h-[90vh] w-auto mx-auto rounded-lg" />
            </div>
        </div>
    );
};

interface ConfirmationsTabProps {
    confirmations: Confirmation[];
    onConfirm: (confirmationId: string) => void;
    onReject: (confirmationId: string) => void;
}

const ConfirmationsTab: React.FC<ConfirmationsTabProps> = ({ confirmations, onConfirm, onReject }) => {
    const [viewingProof, setViewingProof] = useState<string | null>(null);
    const [dialogState, setDialogState] = useState<{
        isOpen: boolean;
        action: 'confirm' | 'reject' | null;
        confirmationId: string | null;
        title: string;
        message: string;
    }>({ isOpen: false, action: null, confirmationId: null, title: '', message: '' });

    const openConfirmationDialog = (action: 'confirm' | 'reject', confirmation: Confirmation) => {
        setDialogState({
            isOpen: true,
            action,
            confirmationId: confirmation.id,
            title: action === 'confirm' ? 'Confirm Payment?' : 'Reject Payment?',
            message: `Are you sure you want to ${action} this payment of ₹${confirmation.amount.toLocaleString()} from ${confirmation.senderName}? This action cannot be undone.`
        });
    };

    const handleDialogConfirm = () => {
        if (dialogState.action && dialogState.confirmationId) {
            if (dialogState.action === 'confirm') {
                onConfirm(dialogState.confirmationId);
            } else {
                onReject(dialogState.confirmationId);
            }
        }
        setDialogState({ isOpen: false, action: null, confirmationId: null, title: '', message: '' });
    };

    const handleDialogClose = () => {
        setDialogState({ isOpen: false, action: null, confirmationId: null, title: '', message: '' });
    };
    
    if (confirmations.length === 0) {
        return (
            <div className="card text-center">
                <i className="fas fa-envelope-open-text text-4xl text-gray-400 mb-4"></i>
                <h3 className="font-bold text-lg">No Pending Confirmations</h3>
                <p className="text-gray-500">There are currently no payments awaiting your confirmation.</p>
            </div>
        );
    }
    
    return (
        <div className="space-y-4">
            {confirmations.map(c => (
                 <div key={c.id} className="p-4 border bg-white shadow-sm rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <div className="md:col-span-2">
                        <p className="font-bold">{c.type} from {c.senderName}</p>
                        <p className="text-lg font-bold text-green-600">₹{c.amount.toLocaleString()}</p>
                        <p className="text-sm text-gray-500">Date: {c.date}</p>
                        <p className="text-sm text-gray-500">Transaction ID: <span className="font-mono">{c.transactionId}</span></p>
                    </div>
                    <div className="space-y-3">
                         <div>
                            <p className="text-center text-xs font-semibold text-gray-700 mb-1">Time left to confirm:</p>
                            <CountdownTimer expiryTimestamp={c.submittedTimestamp + PAYMENT_TIMER_DURATION} />
                        </div>
                        <div className="flex items-center gap-3 justify-end">
                            <button onClick={() => setViewingProof(c.proof)} className="btn btn-secondary !py-1.5 !px-3 text-xs">
                               <i className="fas fa-receipt mr-1"></i> Proof
                            </button>
                            <button onClick={() => openConfirmationDialog('reject', c)} className="btn btn-red !py-1.5 !px-3 text-xs">Reject</button>
                            <button onClick={() => openConfirmationDialog('confirm', c)} className="btn btn-green !py-1.5 !px-3 text-xs">
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            ))}
            <ProofModal isOpen={!!viewingProof} onClose={() => setViewingProof(null)} proofUrl={viewingProof} />
            <ConfirmationDialog
                isOpen={dialogState.isOpen}
                onClose={handleDialogClose}
                onConfirm={handleDialogConfirm}
                title={dialogState.title}
                message={dialogState.message}
                confirmButtonText={dialogState.action === 'confirm' ? 'Confirm' : 'Reject'}
                confirmButtonClass={dialogState.action === 'confirm' ? 'btn-outline-green' : 'btn-outline-red'}
            />
        </div>
    );
};


const MatrixTab = () => {
    const [activeLevelId, setActiveLevelId] = useState<number | null>(1);
    const [currentPage, setCurrentPage] = useState(1);
    const totalMatrixIncome = Object.values(initialMatrixData.levels).reduce((sum, level) => sum + level.income, 0);
    
    const itemsPerPage = 5;
    const totalPages = Math.ceil(initialMatrixData.queue.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentQueueItems = initialMatrixData.queue.slice(startIndex, endIndex);

    const getLevelStatusInfo = (levelData: MatrixLevel) => {
        if (levelData.filled === levelData.capacity) {
            return {
                text: 'Complete',
                icon: 'fa-check-circle',
                style: 'bg-green-100 text-green-700',
            };
        }
        if (levelData.filled > 0) {
            return {
                text: 'Filling',
                icon: 'fa-hourglass-half',
                style: 'bg-blue-100 text-blue-700',
            };
        }
        return {
            text: 'Empty',
            icon: 'fa-circle',
            style: 'bg-gray-200 text-gray-600',
        };
    };
    
    const nextPayoutLevel = Object.entries(initialMatrixData.levels).find(([level, data]) => data.filled < data.capacity);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card text-center">
                    <i className="fas fa-sitemap text-3xl text-[var(--primary)] mb-2"></i>
                    <div className="text-2xl font-bold">₹{totalMatrixIncome.toLocaleString()}</div>
                    <div className="text-gray-500">Total Matrix Income</div>
                </div>
                <div className="card text-center">
                    <i className="fas fa-users text-3xl text-[var(--primary)] mb-2"></i>
                    <div className="text-2xl font-bold">{Object.values(initialMatrixData.levels).reduce((sum, l) => sum + l.filled, 0)}</div>
                    <div className="text-gray-500">Total Matrix Members</div>
                </div>
                <div className="card text-center">
                     <i className="fas fa-arrow-circle-down text-3xl text-[var(--primary)] mb-2"></i>
                    <div className="text-2xl font-bold">{nextPayoutLevel ? `Level ${nextPayoutLevel[0]}` : 'All Full'}</div>
                    <div className="text-gray-500">Next Payout Level</div>
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-xl font-bold"><i className="fas fa-layer-group mr-2"></i> Matrix Levels</h3>
                {Object.entries(initialMatrixData.levels).map(([levelStr, data]) => {
                    const level = parseInt(levelStr);
                    const isActive = activeLevelId === level;
                    const statusInfo = getLevelStatusInfo(data);

                    return (
                        <div key={level} className="card p-0 overflow-hidden transition-shadow hover:shadow-md">
                            <button
                                onClick={() => setActiveLevelId(isActive ? null : level)}
                                className="flex justify-between items-center w-full p-4 text-left"
                                aria-expanded={isActive}
                                aria-controls={`level-details-${level}`}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold flex-shrink-0 transition-colors ${statusInfo.style}`}>
                                        <i className={`fas ${statusInfo.icon}`}></i>
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-gray-800">Level {level}</h3>
                                        <p className="text-sm text-gray-500">
                                            {data.filled} / {data.capacity} Members
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 ml-4">
                                    <div className="hidden sm:block">
                                        <span className={`px-3 py-1 text-xs font-bold rounded-full ${statusInfo.style}`}>{statusInfo.text.toUpperCase()}</span>
                                    </div>
                                    <i className={`fas fa-chevron-down text-gray-400 transition-transform duration-300 ${isActive ? 'rotate-180' : ''}`}></i>
                                </div>
                            </button>
                            {isActive && (
                                <div id={`level-details-${level}`} className="p-4 sm:p-6 border-t border-gray-100 animate-fadeIn">
                                    <h3 className="font-bold mb-3 text-lg">Level {level} Details</h3>
                                    <div className="flex items-center mb-4">
                                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                                            <div className="bg-blue-500 h-2.5 rounded-full" style={{ width: `${(data.filled / data.capacity) * 100}%` }}></div>
                                        </div>
                                        <span className="ml-4 font-bold text-sm">{data.filled} / {data.capacity}</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center text-sm mb-6">
                                        <div className="bg-gray-50 p-3 rounded-lg"><strong>Income from Level:</strong> ₹{data.income.toLocaleString()}</div>
                                        <div className="bg-gray-50 p-3 rounded-lg"><strong>Commission per User:</strong> ₹{initialMatrixData.commissionPerLevel.toLocaleString()}</div>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold mb-3 text-gray-700">Level {level} Placement</h4>
                                        <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
                                            {Array.from({ length: data.capacity }).map((_, index) => {
                                                const user = data.users[index];
                                                if (user) {
                                                    return (
                                                        <div 
                                                            key={user.id} 
                                                            title={`${user.name}\nJoined: ${user.joinTime}`} 
                                                            className="text-center p-2 bg-green-50 border border-green-200 rounded-lg shadow-sm animate-scaleIn aspect-square flex flex-col justify-center items-center"
                                                        >
                                                            <i className="fas fa-user-check text-green-500 text-xl mb-1"></i>
                                                            <p className="text-xs font-semibold truncate text-gray-800 w-full">{user.name}</p>
                                                        </div>
                                                    );
                                                } else {
                                                    return (
                                                        <div 
                                                            key={`empty-${index}`} 
                                                            className="text-center p-2 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg flex flex-col justify-center items-center aspect-square"
                                                        >
                                                            <i className="fas fa-plus text-gray-400 text-lg"></i>
                                                        </div>
                                                    );
                                                }
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            
            <div className="card">
                <h3 className="text-xl font-bold mb-4"><i className="fas fa-users-cog mr-2"></i> Global Matrix Queue</h3>
                <p className="text-sm text-gray-600 mb-4 p-3 bg-gray-50 rounded-lg border">
                    <i className="fas fa-info-circle mr-2 text-gray-500"></i>
                    The queue operates on a "first-in, first-out" basis. Your position is determined by your join time, ensuring everyone is placed in the order they activate their account.
                </p>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="p-3 text-center font-semibold text-gray-600 w-16">#</th>
                                <th className="p-3 text-left font-semibold text-gray-600">User</th>
                                <th className="p-3 text-left font-semibold text-gray-600">Join Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentQueueItems.map((user) => (
                                <tr key={user.id} className="border-t border-gray-200 hover:bg-gray-50 transition-colors">
                                    <td className="p-3 text-center">
                                        <span className="flex items-center justify-center w-8 h-8 mx-auto rounded-full bg-[var(--primary)] text-white font-bold text-sm">
                                            {user.queuePosition}
                                        </span>
                                    </td>
                                    <td className="p-3 font-medium text-gray-800">{user.name}</td>
                                    <td className="p-3 text-gray-500">{user.joinTime}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <PaginationControls
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                />
            </div>
        </div>
    );
};

const BinaryTab = ({ binaryData, sponsorData, isQualifiedForBinary, onQualify, onProcessQueue }) => {
    const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
    const [isPendingHistoryExpanded, setIsPendingHistoryExpanded] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);

    const totalLeft = binaryData.leftTeam.length;
    const totalRight = binaryData.rightTeam.length;
    const totalBinaryIncome = binaryData.matchedPairs.reduce((sum, pair) => sum + pair.amount, 0);
    const totalPendingIncome = binaryData.pendingPairs.reduce((sum, pair) => sum + pair.amount, 0);

    const allProcessedPairs = [...binaryData.matchedPairs, ...binaryData.pendingPairs];
    const matchedLeftCount = allProcessedPairs.reduce((sum, pair) => sum + pair.leftUsers.length, 0);
    const matchedRightCount = allProcessedPairs.reduce((sum, pair) => sum + pair.rightUsers.length, 0);

    const leftCarryForwardUsers = binaryData.leftTeam.slice(matchedLeftCount);
    const rightCarryForwardUsers = binaryData.rightTeam.slice(matchedRightCount);
    
    const hasLeftSponsor = sponsorData.directs.some(d => d.position === 'left' && d.status === 'paid');
    const hasRightSponsor = sponsorData.directs.some(d => d.position === 'right' && d.status === 'paid');

    const itemsPerPage = 5;
    const totalPages = Math.ceil(binaryData.matchingQueue.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentQueueItems = binaryData.matchingQueue.slice(startIndex, endIndex);

    // Fix: Use React.FC to correctly type component props and handle reserved props like 'key'.
    const MatchCard: React.FC<{ pair: MatchedPair }> = ({ pair }) => (
        <div className="p-4 border border-green-200 bg-green-50 rounded-lg animate-fadeIn">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-green-200">
                <h4 className="font-bold text-green-800">Match #{pair.pairNumber} Complete</h4>
                <div className="text-right">
                    <p className="font-bold text-lg text-green-600">₹{pair.amount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{pair.date}</p>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    {pair.leftUsers.map((user) => (
                        <div key={user} className="flex items-center p-2 rounded-md text-sm font-medium bg-white shadow-sm text-gray-800">
                             <i className="fas fa-arrow-left mr-3 text-blue-500"></i>
                             <span>{user}</span>
                        </div>
                    ))}
                </div>
                <div className="space-y-2">
                    {pair.rightUsers.map((user) => (
                        <div key={user} className="flex items-center p-2 rounded-md text-sm font-medium bg-white shadow-sm text-gray-800">
                             <i className="fas fa-arrow-right mr-3 text-red-500"></i>
                             <span>{user}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
    
    // Fix: Use React.FC to correctly type component props and handle reserved props like 'key'.
    const PendingMatchCard: React.FC<{ pair: MatchedPair }> = ({ pair }) => (
        <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg animate-fadeIn">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-blue-200">
                <h4 className="font-bold text-blue-800">Match #{pair.pairNumber} Pending</h4>
                <div className="text-right">
                    <p className="font-bold text-lg text-blue-600">₹{pair.amount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{pair.date}</p>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    {pair.leftUsers.map((user) => (
                        <div key={user} className="flex items-center p-2 rounded-md text-sm font-medium bg-white shadow-sm text-gray-800">
                             <i className="fas fa-arrow-left mr-3 text-blue-500"></i>
                             <span>{user}</span>
                        </div>
                    ))}
                </div>
                <div className="space-y-2">
                    {pair.rightUsers.map((user) => (
                        <div key={user} className="flex items-center p-2 rounded-md text-sm font-medium bg-white shadow-sm text-gray-800">
                             <i className="fas fa-arrow-right mr-3 text-red-500"></i>
                             <span>{user}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );


    const CarryForwardCard = ({ users, side }) => {
        const title = side === 'left' ? 'Left Carry Forward' : 'Right Carry Forward';
        const countColor = side === 'left' ? 'text-blue-600' : 'text-red-600';
        const icon = side === 'left' ? 'fa-arrow-left text-blue-500' : 'fa-arrow-right text-red-500';

        return (
            <div className="card">
                <h3 className="text-xl font-bold mb-2">{title}</h3>
                <div className={`text-3xl font-bold ${countColor} mb-3`}>{users.length}</div>
                <div className="bg-gray-50 p-3 rounded-lg max-h-48 overflow-y-auto space-y-2">
                    {users.length > 0 ? (
                        users.map((user) => (
                             <div key={user} className="flex items-center p-2 rounded-md text-sm font-medium bg-white shadow-sm text-gray-800">
                                <i className={`fas ${icon} mr-3`}></i>
                                <span>{user}</span>
                             </div>
                        ))
                    ) : (
                        <p className="text-sm text-center text-gray-500 py-4">No users to carry forward.</p>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="card text-center">
                    <i className="fas fa-balance-scale text-3xl text-[var(--primary)] mb-2"></i>
                    <div className="text-2xl font-bold">₹{totalBinaryIncome.toLocaleString()}</div>
                    <div className="text-gray-500">Total Binary Income</div>
                </div>
                <div className="card text-center bg-blue-50">
                    <i className="fas fa-arrow-left text-3xl text-blue-500 mb-2"></i>
                    <div className="text-2xl font-bold">{totalLeft}</div>
                    <div className="text-gray-500">Total Left Team</div>
                </div>
                <div className="card text-center bg-red-50">
                    <i className="fas fa-arrow-right text-3xl text-red-500 mb-2"></i>
                    <div className="text-2xl font-bold">{totalRight}</div>
                    <div className="text-gray-500">Total Right Team</div>
                </div>
                <div className="card text-center bg-yellow-50">
                    <i className="fas fa-pause-circle text-3xl text-yellow-600 mb-2"></i>
                    <div className="text-2xl font-bold">₹{totalPendingIncome.toLocaleString()}</div>
                    <div className="text-gray-500">Pending Income</div>
                </div>
            </div>

            <div className="card">
                <h3 className="text-xl font-bold mb-4">Binary Income Qualification</h3>
                <p className="text-sm text-gray-600 mb-4">You must sponsor at least 1 direct referral on your Left and 1 on your Right team to earn binary income. This is a one-time requirement.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className={`p-4 rounded-lg text-center border-2 ${hasLeftSponsor ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                        <i className={`fas ${hasLeftSponsor ? 'fa-check-circle text-green-500' : 'fa-times-circle text-red-500'} text-2xl mb-2`}></i>
                        <h4 className="font-bold">Sponsor 1 Left</h4>
                        <p className="text-sm font-semibold">{hasLeftSponsor ? 'Completed' : 'Pending'}</p>
                    </div>
                    <div className={`p-4 rounded-lg text-center border-2 ${hasRightSponsor ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                        <i className={`fas ${hasRightSponsor ? 'fa-check-circle text-green-500' : 'fa-times-circle text-red-500'} text-2xl mb-2`}></i>
                        <h4 className="font-bold">Sponsor 1 Right</h4>
                        <p className="text-sm font-semibold">{hasRightSponsor ? 'Completed' : 'Pending'}</p>
                    </div>
                </div>
                {!isQualifiedForBinary && (
                    <div className="text-center mt-4">
                        <p className="text-red-600 font-bold animate-pulse">Your binary income is locked until this condition is met.</p>
                        <button onClick={onQualify} className="btn btn-primary mt-2">
                           <i className="fas fa-rocket mr-2"></i> Click to Simulate Qualification
                        </button>
                    </div>
                )}
                <div className="mt-4 p-3 bg-blue-50 border-2 border-blue-200 rounded-lg text-sm text-blue-800 text-center">
                    <i className="fas fa-info-circle mr-2"></i>
                    Any binary income generated while you are unqualified will be held as 'Pending' and paid out instantly once you qualify.
                </div>
            </div>

            <div className="card">
                <h3 className="text-xl font-bold mb-4"><i className="fas fa-users-cog mr-2"></i> Global Binary Matching Queue</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="md:col-span-1 card text-center bg-indigo-50 border-2 border-indigo-200">
                         <i className="fas fa-street-view text-3xl text-indigo-500 mb-2"></i>
                        <div className="text-4xl font-extrabold text-indigo-700">#{binaryData.currentUserPosition}</div>
                        <div className="font-bold text-gray-600">Your Position</div>
                    </div>
                     <div className="md:col-span-2 p-4 bg-gray-50 rounded-lg border">
                         <h4 className="font-bold text-gray-800 mb-2">How the Queue Works</h4>
                        <p className="text-sm text-gray-600 mb-3">
                            <i className="fas fa-info-circle mr-2 text-gray-500"></i>
                            The system awards the next binary match to the first <span className="font-bold text-green-600">qualified</span> user at the top of the queue. If a user at the front is not qualified, they are moved to the end of the queue, and the next person is checked.
                        </p>
                         <button onClick={onProcessQueue} className="btn btn-secondary w-full">
                            <i className="fas fa-play-circle mr-2"></i> Process Next Match in Queue
                        </button>
                    </div>
                </div>
                
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="p-3 text-center font-semibold text-gray-600 w-16">#</th>
                                <th className="p-3 text-left font-semibold text-gray-600">User</th>
                                <th className="p-3 text-center font-semibold text-gray-600">Status</th>
                                <th className="p-3 text-left font-semibold text-gray-600">Join Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentQueueItems.map((user) => (
                                <tr key={user.id} className={`border-t border-gray-200 transition-colors ${user.queuePosition === binaryData.currentUserPosition ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                                    <td className="p-3 text-center">
                                        <span className={`flex items-center justify-center w-8 h-8 mx-auto rounded-full font-bold text-sm ${user.queuePosition === binaryData.currentUserPosition ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}>
                                            {user.queuePosition}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-3">
                                            <img src={user.profilePicture} alt={user.name} className="w-8 h-8 rounded-full object-cover"/>
                                             <div className="flex items-center gap-2">
                                                <span className="font-medium text-gray-800">{user.name}</span>
                                                {user.queuePosition === binaryData.currentUserPosition && (
                                                    <span className="text-xs font-bold bg-blue-500 text-white px-2 py-0.5 rounded-full">YOU</span>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-3 text-center">
                                        {user.isQualified ? (
                                            <span title="Qualified" className="text-green-500"><i className="fas fa-check-circle text-lg"></i></span>
                                        ) : (
                                            <span title="Not Qualified" className="text-red-500"><i className="fas fa-times-circle text-lg"></i></span>
                                        )}
                                    </td>
                                    <td className="p-3 text-gray-500">{user.joinTime}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <PaginationControls
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                 <div className="lg:col-span-2 space-y-4">
                    <div className="card p-0 overflow-hidden">
                        <button
                            onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                            className="flex justify-between items-center w-full p-4 text-left"
                            aria-expanded={isHistoryExpanded}
                        >
                            <h3 className="text-xl font-bold">Matched Pairs History ({binaryData.matchedPairs.length})</h3>
                            <i className={`fas fa-chevron-down text-gray-400 transition-transform duration-300 ${isHistoryExpanded ? 'rotate-180' : ''}`}></i>
                        </button>
                        {isHistoryExpanded && (
                            <div className="p-4 border-t space-y-4 animate-fadeIn">
                                {binaryData.matchedPairs.map(pair => (
                                    <MatchCard key={pair.pairNumber} pair={pair} />
                                ))}
                                {binaryData.matchedPairs.length === 0 && (
                                    <div className="text-center p-6 bg-gray-50 rounded-lg">
                                        <i className="fas fa-users text-3xl text-gray-400 mb-2"></i>
                                        <p className="font-semibold text-gray-600">No Matched Pairs Yet</p>
                                        <p className="text-sm text-gray-500">As your teams grow, matched pairs will appear here.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    
                    <div className="card p-0 overflow-hidden">
                        <button
                            onClick={() => setIsPendingHistoryExpanded(!isPendingHistoryExpanded)}
                            className="flex justify-between items-center w-full p-4 text-left"
                            aria-expanded={isPendingHistoryExpanded}
                        >
                            <h3 className="text-xl font-bold">Pending Matches History ({binaryData.pendingPairs.length})</h3>
                            <i className={`fas fa-chevron-down text-gray-400 transition-transform duration-300 ${isPendingHistoryExpanded ? 'rotate-180' : ''}`}></i>
                        </button>
                        {isPendingHistoryExpanded && (
                            <div className="p-4 border-t space-y-4 animate-fadeIn">
                                {binaryData.pendingPairs.map(pair => (
                                    <PendingMatchCard key={pair.pairNumber} pair={pair} />
                                ))}
                                {binaryData.pendingPairs.length === 0 && (
                                    <div className="text-center p-6 bg-gray-50 rounded-lg">
                                        <i className="fas fa-check-circle text-3xl text-gray-400 mb-2"></i>
                                        <p className="font-semibold text-gray-600">No Pending Matches</p>
                                        <p className="text-sm text-gray-500">All generated binary income has been credited.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                 </div>

                <div className="space-y-6">
                    <CarryForwardCard users={leftCarryForwardUsers} side="left" />
                    <CarryForwardCard users={rightCarryForwardUsers} side="right" />
                </div>
            </div>
        </div>
    );
};

const SponsorTab = ({ sponsorData }) => {
    const totalSponsorIncome = sponsorData.directs.filter(i => i.status === 'paid').reduce((sum, inc) => sum + inc.amount, 0);
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card text-center">
                    <i className="fas fa-users text-3xl text-[var(--primary)] mb-2"></i>
                    <div className="text-2xl font-bold">₹{totalSponsorIncome.toLocaleString()}</div>
                    <div className="text-gray-500">Total Sponsor Income</div>
                </div>
                <div className="card text-center">
                    <i className="fas fa-user-plus text-3xl text-[var(--primary)] mb-2"></i>
                    <div className="text-2xl font-bold">{sponsorData.directs.length}</div>
                    <div className="text-gray-500">Direct Referrals</div>
                </div>
            </div>

            <div className="card">
                <h3 className="text-xl font-bold mb-4"><i className="fas fa-history mr-2"></i> Sponsor Income History</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="p-3 text-left">Date</th>
                                <th className="p-3 text-left">Name</th>
                                <th className="p-3 text-left">Position</th>
                                <th className="p-3 text-left">Amount</th>
                                <th className="p-3 text-left">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sponsorData.directs.map((item, index) => (
                                <tr key={index} className="border-b">
                                    <td className="p-3">{item.date}</td>
                                    <td className="p-3">{item.name}</td>
                                    <td className="p-3 capitalize">{item.position}</td>
                                    <td className="p-3 font-bold">₹{item.amount.toLocaleString()}</td>
                                    <td className="p-3"><StatusBadge status={item.status} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const TransactionsTab = ({ transactions }: { transactions: Transaction[] }) => {
    return (
        <div className="card">
            <h2 className="text-2xl font-bold mb-4">Transaction History</h2>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="p-4">Date</th>
                            <th className="p-4">Type</th>
                            <th className="p-4">Details</th>
                            <th className="p-4">Amount</th>
                            <th className="p-4">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {transactions.map((t, i) => (
                            <tr key={i} className="border-b last:border-b-0">
                                <td className="p-4">{t.date}</td>
                                <td className="p-4"><IncomeTypeBadge type={t.type} /></td>
                                <td className="p-4">{t.details}</td>
                                <td className="p-4 font-bold">₹{t.amount.toLocaleString()}</td>
                                <td className="p-4"><StatusBadge status={t.status} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};


const ProfileTab = ({ profile, onProfileChange }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
    const qrCodeInputRef = useRef<HTMLInputElement>(null);
    const profilePictureInputRef = useRef<HTMLInputElement>(null);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        if (name in profile.notifications) {
            onProfileChange(p => ({ ...p, notifications: { ...p.notifications, [name]: checked } }));
        } else if (name in profile.paymentDetails) {
            onProfileChange(p => ({ ...p, paymentDetails: { ...p.paymentDetails, [name]: value } }));
        } else {
            onProfileChange(p => ({ ...p, [name]: value }));
        }
    };
    
    const handleQRCodeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => {
                onProfileChange(p => ({
                    ...p,
                    paymentDetails: {
                        ...p.paymentDetails,
                        upiQRCode: reader.result as string,
                    }
                }));
            };
            reader.readAsDataURL(file);
        }
    };
    
    const handleProfilePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (file.size > 2 * 1024 * 1024) { // 2MB size limit
                alert("File is too large. Please select an image under 2MB.");
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                onProfileChange(p => ({
                    ...p,
                    profilePicture: reader.result as string,
                }));
            };
            reader.readAsDataURL(file);
        }
    };


    const handleSaveClick = () => {
        if (isEditing) {
            setIsConfirmDialogOpen(true);
        } else {
            setIsEditing(true);
        }
    };

    const handleConfirmSave = () => {
        setIsEditing(false);
        setIsConfirmDialogOpen(false);
        // Saving to localStorage is handled by parent component's useEffect
    };

    return (
        <>
            <div className="card max-w-4xl mx-auto">
                <div className="flex flex-col md:flex-row items-center gap-6 mb-6 pb-6 border-b">
                    <div className="relative group flex-shrink-0">
                        <img src={profile.profilePicture} alt="Profile" className="w-24 h-24 rounded-full object-cover ring-4 ring-offset-2 ring-[var(--primary)]" />
                        {isEditing && (
                            <button
                                type="button"
                                onClick={() => profilePictureInputRef.current?.click()}
                                className="absolute inset-0 bg-black bg-opacity-50 text-white flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Change profile picture"
                            >
                                <i className="fas fa-camera text-2xl"></i>
                            </button>
                        )}
                    </div>
                    <input
                        type="file"
                        ref={profilePictureInputRef}
                        className="hidden"
                        accept="image/png, image/jpeg, image/gif"
                        onChange={handleProfilePictureChange}
                    />
                    <div>
                        <h2 className="text-2xl font-bold">{profile.name}</h2>
                        <p className="text-gray-500">{profile.email}</p>
                    </div>
                    <button onClick={handleSaveClick} className="btn btn-primary md:ml-auto mt-4 md:mt-0">
                        {isEditing ? <><i className="fas fa-save mr-2"></i>Save Changes</> : <><i className="fas fa-pencil-alt mr-2"></i>Edit Profile</>}
                    </button>
                </div>

                <div className="space-y-8">
                    {/* Personal Information Section */}
                    <div>
                        <h3 className="text-lg font-bold mb-4 border-b pb-2">Personal Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-sm font-medium text-gray-600 block mb-1">Full Name</label>
                                <input type="text" name="name" value={profile.name} onChange={handleInputChange} disabled={!isEditing} className="input-field" placeholder="Full Name" />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-600 block mb-1">Email Address</label>
                                <input type="email" name="email" value={profile.email} onChange={handleInputChange} disabled={!isEditing} className="input-field" placeholder="Email Address" />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-600 block mb-1">Phone Number</label>
                                <input type="tel" name="phone" value={profile.phone} onChange={handleInputChange} disabled={!isEditing} className="input-field" placeholder="Phone Number" />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-600 block mb-1">Join Date</label>
                                <input type="text" value={profile.joinDate} disabled className="input-field bg-gray-100 cursor-not-allowed" />
                            </div>
                        </div>
                    </div>

                    {/* Payment Details Section */}
                    <div>
                        <h3 className="text-lg font-bold mb-4 border-b pb-2">Payment Receiving Details</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
                            {/* Left side: UPI and Crypto */}
                            <div className="space-y-6">
                                <div>
                                    <h4 className="font-semibold text-gray-800 mb-3">UPI Details</h4>
                                    <label className="text-sm font-medium text-gray-600 block mb-1">UPI ID</label>
                                    <input type="text" name="upiId" value={profile.paymentDetails.upiId} onChange={handleInputChange} disabled={!isEditing} className="input-field" placeholder="yourname@upi" />
                                     
                                     {isEditing && (
                                        <>
                                            <input
                                                type="file"
                                                ref={qrCodeInputRef}
                                                className="hidden"
                                                onChange={handleQRCodeUpload}
                                                accept="image/png, image/jpeg, image/gif"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => qrCodeInputRef.current?.click()}
                                                className="btn btn-secondary text-sm mt-2 w-full"
                                            >
                                                <i className="fas fa-upload mr-2"></i> Upload Custom QR Code
                                            </button>
                                        </>
                                    )}

                                    <div className="mt-4">
                                        <label className="text-sm font-medium text-gray-600 block mb-2">Your UPI QR Code</label>
                                        <div className="p-4 bg-gray-50 rounded-lg inline-block border relative">
                                            {profile.paymentDetails.upiQRCode ? (
                                                <img src={profile.paymentDetails.upiQRCode} alt="Custom UPI QR Code" className="rounded-md w-[150px] h-[150px] object-cover" />
                                            ) : profile.paymentDetails.upiId ? (
                                                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=upi://pay?pa=${profile.paymentDetails.upiId}&pn=${encodeURIComponent(profile.name)}`} alt="UPI QR Code" className="rounded-md" />
                                            ) : (
                                                <div className="w-[150px] h-[150px] flex items-center justify-center text-center text-xs text-gray-500">
                                                    Enter UPI ID or upload a custom QR code.
                                                </div>
                                            )}
                                            {isEditing && profile.paymentDetails.upiQRCode && (
                                                <button
                                                    type="button"
                                                    onClick={() => onProfileChange(p => ({ ...p, paymentDetails: { ...p.paymentDetails, upiQRCode: null } }))}
                                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs shadow-md hover:bg-red-600 transition-transform hover:scale-110"
                                                    title="Remove custom QR code"
                                                >
                                                    <i className="fas fa-times"></i>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="font-semibold text-gray-800 mb-3">Crypto Wallet</h4>
                                    <label className="text-sm font-medium text-gray-600 block mb-1">USDT BEP20 Address</label>
                                    <input type="text" name="usdtAddress" value={profile.paymentDetails.usdtAddress} onChange={handleInputChange} disabled={!isEditing} className="input-field" placeholder="0x..." />
                                </div>
                            </div>

                            {/* Right side: Bank Account */}
                            <div className="space-y-4">
                                <h4 className="font-semibold text-gray-800 mb-3">Bank Account Details</h4>
                                 <div>
                                    <label className="text-sm font-medium text-gray-600 block mb-1">Account Holder Name</label>
                                    <input type="text" name="accountHolder" value={profile.paymentDetails.accountHolder} onChange={handleInputChange} disabled={!isEditing} className="input-field" placeholder="Full Name as per bank" />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-600 block mb-1">Bank Account Number</label>
                                    <input type="text" name="accountNumber" value={profile.paymentDetails.accountNumber} onChange={handleInputChange} disabled={!isEditing} className="input-field" placeholder="Enter account number" />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-600 block mb-1">Bank Name</label>
                                    <input type="text" name="bankName" value={profile.paymentDetails.bankName} onChange={handleInputChange} disabled={!isEditing} className="input-field" placeholder="Enter bank name" />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-600 block mb-1">IFSC Code</label>
                                    <input type="text" name="ifsc" value={profile.paymentDetails.ifsc} onChange={handleInputChange} disabled={!isEditing} className="input-field" placeholder="Enter IFSC code" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <ConfirmationDialog
                isOpen={isConfirmDialogOpen}
                onClose={() => setIsConfirmDialogOpen(false)}
                onConfirm={handleConfirmSave}
                title="Save Profile?"
                message="Are you sure you want to save these changes to your profile?"
                confirmButtonText="Save"
            />
        </>
    );
};

interface UserDetailModalProps {
    user: AdminUser | null;
    onClose: () => void;
    onSaveNotes: (userId: string, notes: string) => void;
}

const UserDetailModal: React.FC<UserDetailModalProps> = ({ user, onClose, onSaveNotes }) => {
    const [activeTab, setActiveTab] = useState('transactions');
    const [notes, setNotes] = useState(user?.notes || '');

    useEffect(() => {
        setNotes(user?.notes || '');
    }, [user]);

    if (!user) return null;

    const handleSave = () => {
        onSaveNotes(user.id, notes);
        onClose(); 
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 animate-fadeIn" onClick={onClose}>
            <div className="card w-full max-w-3xl max-h-[90vh] flex flex-col animate-scaleIn" onClick={e => e.stopPropagation()}>
                <div className="flex-shrink-0">
                    <div className="flex items-center justify-between pb-4 border-b">
                        <div className="flex items-center gap-4">
                            <img src={user.profilePicture} alt={user.name} className="w-16 h-16 rounded-full object-cover" />
                            <div>
                                <h2 className="text-2xl font-bold">{user.name}</h2>
                                <p className="text-gray-500">Joined: {user.joinDate}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
                    </div>
                    <div className="flex border-b mt-4">
                        <button onClick={() => setActiveTab('transactions')} className={`py-2 px-4 font-semibold ${activeTab === 'transactions' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)]' : 'text-gray-500'}`}>Transaction History</button>
                        <button onClick={() => setActiveTab('notes')} className={`py-2 px-4 font-semibold ${activeTab === 'notes' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)]' : 'text-gray-500'}`}>Admin Notes</button>
                    </div>
                </div>
                <div className="flex-grow overflow-y-auto pt-4">
                    {activeTab === 'transactions' && (
                         user.transactions.length > 0 ? (
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="p-3 text-left">Date</th>
                                        <th className="p-3 text-left">Type</th>
                                        <th className="p-3 text-left">Details</th>
                                        <th className="p-3 text-left">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {user.transactions.map((tx, index) => (
                                        <tr key={index} className="border-b">
                                            <td className="p-3">{tx.date}</td>
                                            <td className="p-3"><IncomeTypeBadge type={tx.type} /></td>
                                            <td className="p-3">{tx.details}</td>
                                            <td className="p-3 font-bold">₹{tx.amount.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <p className="text-center text-gray-500 py-6">No transaction history available for this user.</p>
                        )
                    )}
                    {activeTab === 'notes' && (
                        <div className="p-2">
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="input-field w-full min-h-[150px]"
                                placeholder="Add notes here..."
                            />
                        </div>
                    )}
                </div>
                <div className="flex-shrink-0 pt-4 border-t flex justify-end">
                    {activeTab === 'notes' && <button onClick={handleSave} className="btn btn-primary">Save Notes</button>}
                </div>
            </div>
        </div>
    );
};

interface AdminTabProps {
    onSelectUser: (user: AdminUser) => void;
    users: AdminUser[];
}

const AdminTab: React.FC<AdminTabProps> = ({ onSelectUser, users }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredUsers = users.filter(user =>
        user.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="card">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                <h2 className="text-2xl font-bold">User Management</h2>
                <div className="relative">
                    <input
                        type="text"
                        placeholder="Search by name..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="input-field pl-10 w-full md:w-64"
                    />
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="p-4">User</th>
                            <th className="p-4">Join Date</th>
                            <th className="p-4">Payment Progress</th>
                            <th className="p-4">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredUsers.map(user => {
                            const progress = (user.paymentsConfirmed / user.totalPayments) * 100;
                            const status = user.status !== 'active' ? user.status : (user.paymentsConfirmed === user.totalPayments ? 'Active' : 'Pending');
                            return (
                                <tr key={user.id} className="border-b last:border-b-0 hover:bg-gray-50 cursor-pointer" onClick={() => onSelectUser(user)}>
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <img src={user.profilePicture} alt={user.name} className="w-10 h-10 rounded-full object-cover" />
                                            <span className="font-semibold">{user.name}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-gray-600">{user.joinDate}</td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                                            </div>
                                            <span className="font-semibold text-gray-700 text-xs">{user.paymentsConfirmed}/{user.totalPayments}</span>
                                        </div>
                                    </td>
                                    <td className="p-4"><StatusBadge status={status} /></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                 {filteredUsers.length === 0 && (
                    <div className="text-center p-6">
                        <p className="font-semibold">No users found matching "{searchTerm}"</p>
                    </div>
                )}
            </div>
        </div>
    );
};

interface DisputesTabProps {
    disputes: Confirmation[];
    onResolveSender: (disputeId: string) => void;
    onResolveReceiver: (disputeId: string) => void;
    allUsers: AdminUser[];
    onViewProof: (proofUrl: string) => void;
}

const DisputesTab: React.FC<DisputesTabProps> = ({ disputes, onResolveSender, onResolveReceiver, allUsers, onViewProof }) => {
    if (disputes.length === 0) {
        return (
            <div className="card text-center">
                <i className="fas fa-shield-alt text-4xl text-gray-400 mb-4"></i>
                <h3 className="font-bold text-lg">No Active Disputes</h3>
                <p className="text-gray-500">There are currently no payments under review.</p>
            </div>
        );
    }
    return (
        <div className="card space-y-4">
            <h2 className="text-2xl font-bold">Dispute Resolution</h2>
            {disputes.map(d => {
                const receiver = allUsers.find(u => u.id === d.receiverId);
                return (
                    <div key={d.id} className="p-4 border border-orange-200 bg-orange-50 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                        <div className="md:col-span-2">
                            <p className="font-bold">{d.paymentTitle}</p>
                            <p className="text-sm">From <span className="font-semibold">{d.senderName}</span> to <span className="font-semibold">{receiver?.name || 'Unknown Receiver'}</span></p>
                            <p className="text-lg font-bold text-orange-700">₹{d.amount.toLocaleString()}</p>
                            <p className="text-xs text-gray-500">Transaction ID: <span className="font-mono">{d.transactionId}</span></p>
                            <p className="text-xs text-gray-500">Disputed On: {d.date}</p>
                        </div>
                        <div className="flex flex-col gap-2 items-stretch">
                            <button onClick={() => onViewProof(d.proof)} className="btn btn-secondary !py-1.5 !px-3 text-xs w-full">
                               <i className="fas fa-receipt mr-2"></i> View Proof
                            </button>
                             <div className="flex gap-2 w-full">
                                <button onClick={() => onResolveReceiver(d.id)} className="btn btn-red !py-1.5 !px-3 text-xs flex-1">For Receiver</button>
                                <button onClick={() => onResolveSender(d.id)} className="btn btn-green !py-1.5 !px-3 text-xs flex-1">For Sender</button>
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    );
};

interface SystemConfigTabProps {
    systemConfig: SystemConfig;
    onSaveConfig: (newConfig: SystemConfig) => void;
    adminPaymentOptions: AdminPaymentOption[];
    onSaveOptions: (newOptions: AdminPaymentOption[]) => void;
    onResetData: () => void;
}

const SystemConfigTab: React.FC<SystemConfigTabProps> = ({ systemConfig, onSaveConfig, adminPaymentOptions, onSaveOptions, onResetData }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [tempConfig, setTempConfig] = useState(systemConfig);
    const [tempOptions, setTempOptions] = useState(adminPaymentOptions);
    const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
    const qrCodeInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

    useEffect(() => {
        setTempConfig(systemConfig);
        setTempOptions(adminPaymentOptions);
    }, [systemConfig, adminPaymentOptions]);

    const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setTempConfig(prev => ({ ...prev, [name]: Number(value) || 0 }));
    };

    const handleOptionChange = (id: string, field: string, value: string, subField?: string) => {
        setTempOptions(prev => prev.map(opt => {
            if (opt.id === id) {
                if (subField) {
                    return { ...opt, [field]: { ...opt[field], [subField]: value } };
                }
                return { ...opt, [field]: value };
            }
            return opt;
        }));
    };
    
    const handleQRCodeUpload = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => {
                setTempOptions(prev => prev.map(opt => opt.id === id ? { ...opt, qrCodeUrl: reader.result as string } : opt));
            };
            reader.readAsDataURL(file);
        }
    };

    const addNewOption = () => {
        const newOption: AdminPaymentOption = {
            id: `opt_${Date.now()}`,
            name: 'New Payment Option',
            upiId: '',
            bankAccount: { name: '', number: '', ifsc: '' },
            usdtAddress: '',
            qrCodeUrl: null,
            receiverContact: ''
        };
        setTempOptions(prev => [...prev, newOption]);
    };
    
    const removeOption = (id: string) => {
        setTempOptions(prev => prev.filter(opt => opt.id !== id));
    };

    const handleSaveClick = () => {
        if (isEditing) {
            setIsConfirmDialogOpen(true);
        } else {
            setIsEditing(true);
        }
    };
    
    const handleConfirmSave = () => {
        onSaveConfig(tempConfig);
        onSaveOptions(tempOptions);
        setIsEditing(false);
        setIsConfirmDialogOpen(false);
    };

    const AmountInput = ({ label, name, value }) => (
        <div>
            <label className="text-sm font-medium text-gray-600 block mb-1">{label}</label>
            <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500">₹</span>
                <input type="number" name={name} value={value} onChange={handleConfigChange} disabled={!isEditing} className="input-field pl-7" />
            </div>
        </div>
    );
    
    return (
        <div className="space-y-6">
            <div className="card">
                <div className="flex justify-between items-center mb-6 pb-4 border-b">
                    <h2 className="text-2xl font-bold">System Configuration</h2>
                    <button onClick={handleSaveClick} className="btn btn-primary">
                        {isEditing ? <><i className="fas fa-save mr-2"></i>Save Changes</> : <><i className="fas fa-pencil-alt mr-2"></i>Edit</>}
                    </button>
                </div>

                <div className="space-y-8">
                    <section>
                        <h3 className="text-lg font-bold mb-4">Joining Amounts</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <AmountInput label="Referral Amount" name="referralAmount" value={tempConfig.referralAmount} />
                            <AmountInput label="Binary Amount" name="binaryAmount" value={tempConfig.binaryAmount} />
                            <AmountInput label="Upline Amount (per level)" name="uplineAmount" value={tempConfig.uplineAmount} />
                            <AmountInput label="Admin Fee" name="adminFeeAmount" value={tempConfig.adminFeeAmount} />
                        </div>
                    </section>

                    <section>
                        <h3 className="text-lg font-bold mb-4">Admin Payment Receiving Options</h3>
                        <div className="space-y-4">
                            {tempOptions.map(opt => (
                                <div key={opt.id} className="p-4 border rounded-lg bg-gray-50/50">
                                    <div className="flex justify-between items-center mb-3">
                                        <input type="text" value={opt.name} onChange={(e) => handleOptionChange(opt.id, 'name', e.target.value)} disabled={!isEditing} className="font-bold text-lg bg-transparent border-0 focus:ring-0 p-0 disabled:text-gray-800" />
                                        {isEditing && <button onClick={() => removeOption(opt.id)} className="btn btn-red !py-1 !px-2 text-xs"><i className="fas fa-trash"></i></button>}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <div>
                                            <label className="text-sm font-medium">UPI ID</label>
                                            <input type="text" value={opt.upiId} onChange={(e) => handleOptionChange(opt.id, 'upiId', e.target.value)} disabled={!isEditing} className="input-field" />
                                        </div>
                                         <div className="col-span-2">
                                            <label className="text-sm font-medium">Bank Account</label>
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                <input type="text" value={opt.bankAccount.name} onChange={(e) => handleOptionChange(opt.id, 'bankAccount', e.target.value, 'name')} placeholder="Holder Name" disabled={!isEditing} className="input-field" />
                                                <input type="text" value={opt.bankAccount.number} onChange={(e) => handleOptionChange(opt.id, 'bankAccount', e.target.value, 'number')} placeholder="Account No." disabled={!isEditing} className="input-field" />
                                                <input type="text" value={opt.bankAccount.ifsc} onChange={(e) => handleOptionChange(opt.id, 'bankAccount', e.target.value, 'ifsc')} placeholder="IFSC" disabled={!isEditing} className="input-field" />
                                            </div>
                                        </div>
                                         <div>
                                            <label className="text-sm font-medium">USDT Address (BEP20)</label>
                                            <input type="text" value={opt.usdtAddress} onChange={(e) => handleOptionChange(opt.id, 'usdtAddress', e.target.value)} disabled={!isEditing} className="input-field" />
                                        </div>
                                         <div>
                                            <label className="text-sm font-medium">Receiver Contact</label>
                                            <input type="text" value={opt.receiverContact} onChange={(e) => handleOptionChange(opt.id, 'receiverContact', e.target.value)} disabled={!isEditing} className="input-field" />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium block mb-1">Custom QR Code</label>
                                            <div className="relative inline-block">
                                                {opt.qrCodeUrl ? <img src={opt.qrCodeUrl} alt="QR" className="w-24 h-24 rounded-md border" /> : <div className="w-24 h-24 bg-gray-200 rounded-md flex items-center justify-center text-xs text-center text-gray-500">No QR</div>}
                                                {isEditing && <button onClick={() => setTempOptions(prev => prev.map(p => p.id === opt.id ? {...p, qrCodeUrl: null} : p))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full h-5 w-5 flex items-center justify-center text-xs shadow-md">&times;</button>}
                                            </div>
                                             {isEditing && (
                                                <>
                                                    {/* Fix: ref callback should not return a value. */}
                                                    <input type="file" ref={el => { qrCodeInputRefs.current[opt.id] = el; }} className="hidden" onChange={(e) => handleQRCodeUpload(opt.id, e)} accept="image/*" />
                                                    <button onClick={() => qrCodeInputRefs.current[opt.id]?.click()} className="btn btn-secondary text-xs mt-2 w-full"><i className="fas fa-upload mr-2"></i>Upload QR</button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {isEditing && <button onClick={addNewOption} className="btn btn-secondary w-full"><i className="fas fa-plus mr-2"></i>Add New Payment Option</button>}
                        </div>
                    </section>
                </div>
            </div>
             <div className="card border-2 border-red-300 bg-red-50">
                <h3 className="text-lg font-bold mb-4 text-red-800">Danger Zone</h3>
                <p className="text-sm text-red-700 mb-4">
                    Resetting the application will clear all stored data, including user progress, transactions, and settings, returning it to its initial state. This action cannot be undone.
                </p>
                <button onClick={onResetData} className="btn btn-red">
                    <i className="fas fa-exclamation-triangle mr-2"></i> Reset Application Data
                </button>
            </div>
             <ConfirmationDialog
                isOpen={isConfirmDialogOpen}
                onClose={() => setIsConfirmDialogOpen(false)}
                onConfirm={handleConfirmSave}
                title="Save System Configuration?"
                message="Are you sure you want to save these changes? This may affect new user registrations."
                confirmButtonText="Save"
            />
        </div>
    );
};


const AIAssistant = ({ isOpen, onClose, history, onSend, isLoading, onSuggestionClick }) => {
    const [input, setInput] = useState('');
    const chatEndRef = useRef(null);

    const suggestions = [
        "How do I get my next binary income?",
        "Explain the matrix queue",
        "Give me a message to share with a new prospect",
    ];

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history]);

    const handleSend = (e) => {
        e.preventDefault();
        if (input.trim()) {
            onSend(input);
            setInput('');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="ai-assistant-container">
            <div className="ai-chat-window">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                        <i className="fas fa-robot text-[var(--primary)]"></i> AI Growth Advisor
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
                </div>
                <div className="flex-1 p-4 overflow-y-auto">
                    <div className="space-y-4">
                        {history.map((msg, index) => (
                            <div key={index} className={`chat-bubble-wrapper ${msg.from === 'user' ? 'user' : 'ai'}`}>
                                <div className="chat-bubble">
                                    {/* Fix: Wrap ReactMarkdown in a div to apply className, resolving TS error. */}
                                    {msg.from === 'ai' ? <div className="prose prose-sm max-w-none"><ReactMarkdown>{msg.text}</ReactMarkdown></div> : msg.text}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                             <div className="chat-bubble-wrapper ai">
                                <div className="chat-bubble">
                                    <div className="typing-indicator">
                                        <span></span><span></span><span></span>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef}></div>
                    </div>
                </div>
                <div className="p-4 border-t bg-gray-50 rounded-b-2xl">
                    {history.length <= 1 && (
                        <div className="flex gap-2 mb-3 flex-wrap">
                            {suggestions.map(s => (
                                <button key={s} onClick={() => onSuggestionClick(s)} className="suggestion-chip">{s}</button>
                            ))}
                        </div>
                    )}
                    <form onSubmit={handleSend} className="flex items-center gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ask for advice..."
                            className="input-field !mt-0"
                        />
                        <button type="submit" className="btn btn-primary" disabled={isLoading}>
                            <i className="fas fa-paper-plane"></i>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

const SidebarNav = ({ isOpen, onToggle, activeTab, onTabChange, visibleTabs, pendingConfirmationsCount, disputesCount }) => {
    const handleTabClick = (tabId) => {
        onTabChange(tabId);
        if (window.innerWidth < 1024) { // Close sidebar on mobile after selection
            onToggle(false);
        }
    };
    
    return (
        <>
            {/* Mobile overlay */}
            <div
                className={`fixed inset-0 bg-black/50 z-30 lg:hidden ${isOpen ? 'block' : 'hidden'}`}
                onClick={() => onToggle(false)}
            ></div>

            <nav className={`fixed top-0 left-0 h-full bg-white z-40 shadow-xl transition-all duration-300 ease-in-out flex flex-col
                ${isOpen ? 'w-64' : 'w-20'}
                lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                
                <div className={`flex items-center border-b ${isOpen ? 'p-4 justify-between' : 'p-4 justify-center'}`}>
                    {isOpen && <h1 className="text-2xl font-extrabold text-[var(--primary)]">PAYBACK247</h1>}
                    <button onClick={() => onToggle(!isOpen)} className="text-gray-500 hover:text-[var(--primary)] lg:hidden">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    {visibleTabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => handleTabClick(tab.id)}
                            className={`sidebar-nav-item w-full ${activeTab === tab.id ? 'active' : ''}`}
                            title={tab.label}
                        >
                            <i className={`fas ${tab.icon} w-8 text-center text-lg ${isOpen ? '' : 'mx-auto'}`}></i>
                            <span className={`ml-3 sidebar-label ${isOpen ? 'opacity-100' : 'opacity-0'}`}>{tab.label}</span>
                             {isOpen && tab.id === 'confirmations' && pendingConfirmationsCount > 0 && (
                                <span className="ml-auto bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{pendingConfirmationsCount}</span>
                            )}
                             {isOpen && tab.id === 'disputes' && disputesCount > 0 && (
                                <span className="ml-auto bg-orange-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{disputesCount}</span>
                            )}
                        </button>
                    ))}
                </div>
            </nav>
        </>
    );
};


// The main component that orchestrates everything
const Home = () => {
    const [initialAppState] = useState(getInitialState);

    const [activeTab, setActiveTab] = useState(initialAppState.activeTab);
    const [systemConfig, setSystemConfig] = useState<SystemConfig>(initialAppState.systemConfig);
    const [adminPaymentOptions, setAdminPaymentOptions] = useState<AdminPaymentOption[]>(initialAppState.adminPaymentOptions);
    const [paymentsData, setPaymentsData] = useState<Payment[]>(initialAppState.paymentsData);
    const [pendingConfirmations, setPendingConfirmations] = useState<Confirmation[]>(initialAppState.pendingConfirmations);
    const [transactionsData, setTransactionsData] = useState<Transaction[]>(initialAppState.transactionsData);
    const [isAdmin, setIsAdmin] = useState(initialAppState.isAdmin);
    const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
    const [allUsers, setAllUsers] = useState<AdminUser[]>(initialAppState.allUsers);
    const [disputes, setDisputes] = useState<Confirmation[]>(initialAppState.disputes);
    const [viewingProof, setViewingProof] = useState<string | null>(null);
    const [isAiAssistantOpen, setIsAiAssistantOpen] = useState(false);
    const [aiChatHistory, setAiChatHistory] = useState([{ from: 'ai', text: "Hi! I'm your AI Growth Advisor. How can I help you maximize your earnings today?" }]);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(initialAppState.isSidebarOpen);
    const [notifications, setNotifications] = useState<Notification[]>(initialAppState.notifications);
    const [binaryData, setBinaryData] = useState<BinaryData>(initialAppState.binaryData);
    const [sponsorData, setSponsorData] = useState<SponsorData>(initialAppState.sponsorData);
    const [profile, setProfile] = useState(initialAppState.profile);

    // Effect to save application state to localStorage
    useEffect(() => {
        const appState = {
            activeTab,
            systemConfig,
            adminPaymentOptions,
            paymentsData,
            pendingConfirmations,
            transactionsData,
            isAdmin,
            allUsers,
            disputes,
            isSidebarOpen,
            notifications,
            binaryData,
            sponsorData,
            profile,
        };
        try {
            localStorage.setItem(APP_STATE_KEY, JSON.stringify(appState));
        } catch (error) {
            console.error("Failed to save state to localStorage", error);
        }
    }, [
        activeTab,
        systemConfig,
        adminPaymentOptions,
        paymentsData,
        pendingConfirmations,
        transactionsData,
        isAdmin,
        allUsers,
        disputes,
        isSidebarOpen,
        notifications,
        binaryData,
        sponsorData,
        profile,
    ]);

    const isAccountActive = paymentsData.every(p => p.status === 'confirmed');
    const hasLeftSponsor = sponsorData.directs.some(d => d.position === 'left' && d.status === 'paid');
    const hasRightSponsor = sponsorData.directs.some(d => d.position === 'right' && d.status === 'paid');
    const isQualifiedForBinary = hasLeftSponsor && hasRightSponsor;
    
    const prevIsQualifiedRef = useRef(isQualifiedForBinary);

    // Effect to process pending binary payments upon qualification
    useEffect(() => {
        if (isQualifiedForBinary && !prevIsQualifiedRef.current && binaryData.pendingPairs.length > 0) {
            
            const totalPayout = binaryData.pendingPairs.reduce((sum, p) => sum + p.amount, 0);
            
            setNotifications(prev => [{
                id: `n${Date.now()}`,
                type: 'income',
                message: `Congratulations! You've qualified for binary income. Pending income of ₹${totalPayout.toLocaleString()} has been paid out.`,
                timestamp: Date.now(),
                isRead: false,
            }, ...prev]);

            setBinaryData(prev => {
                const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
                const paidOutPairs = prev.pendingPairs.map(p => ({
                    ...p,
                    status: 'paid' as 'paid',
                    date: now 
                }));

                const newTransactions = paidOutPairs.map(p => ({
                    date: now,
                    type: 'binary' as 'binary',
                    details: `Pending match #${p.pairNumber} paid out`,
                    amount: p.amount,
                    status: 'paid' as 'paid'
                }));
                setTransactionsData(currentTxs => [...newTransactions, ...currentTxs]);

                return {
                    ...prev,
                    matchedPairs: [...prev.matchedPairs, ...paidOutPairs],
                    pendingPairs: []
                };
            });
        }
        prevIsQualifiedRef.current = isQualifiedForBinary;
    }, [isQualifiedForBinary, binaryData.pendingPairs]);


    // Simulate real-time notifications
    useEffect(() => {
        const intervalId = setInterval(() => {
            const randomNotification = notificationPool[Math.floor(Math.random() * notificationPool.length)];
            const newNotification: Notification = {
                id: `n${Date.now()}`,
                ...randomNotification,
                timestamp: Date.now(),
                isRead: false,
            };
            setNotifications(prev => [newNotification, ...prev]);
        }, 15000); // New notification every 15 seconds

        return () => clearInterval(intervalId);
    }, []);
    
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth <= 1024) {
                setIsSidebarOpen(false);
            } else {
                setIsSidebarOpen(true);
            }
        };
        window.addEventListener('resize', handleResize);
        // Do not call handleResize() here to respect the user's saved preference
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        setBinaryData(prev => ({
            ...prev,
            matchingQueue: prev.matchingQueue.map(user =>
                user.id === 'bq_5'
                    ? { ...user, isQualified: isQualifiedForBinary }
                    : user
            )
        }));
    }, [isQualifiedForBinary]);

    useEffect(() => {
        const timerInterval = setInterval(() => {
            setPaymentsData(prevPayments => {
                let hasChanged = false;
                const updatedPayments = prevPayments.map((p): Payment => {
                    if (p.status === 'unpaid' && p.assignedTimestamp && p.type !== 'admin') {
                        if (Date.now() > p.assignedTimestamp + PAYMENT_TIMER_DURATION) {
                            hasChanged = true;
                            return { ...p, status: 'expired' };
                        }
                    }
                    return p;
                });
                return hasChanged ? updatedPayments : prevPayments;
            });
        }, 1000);

        return () => clearInterval(timerInterval);
    }, []);

    useEffect(() => {
        const confirmationTimerInterval = setInterval(() => {
            const now = Date.now();
            const expiredConfirmations = pendingConfirmations.filter(c => now > (c.submittedTimestamp + PAYMENT_TIMER_DURATION));
            
            if (expiredConfirmations.length > 0) {
                const expiredConfirmationIds = expiredConfirmations.map(c => c.id);

                setPendingConfirmations(prev => prev.filter(c => !expiredConfirmationIds.includes(c.id)));

                setPaymentsData(prevPayments => {
                    const newPayments = [...prevPayments];
                    const newDisputes: Confirmation[] = [];
                    const usersToPutOnHold = new Set<string>();

                    for (const confirmation of expiredConfirmations) {
                        const paymentIndex = newPayments.findIndex(p => p.id === confirmation.paymentId);
                        if (paymentIndex === -1) continue;

                        const payment = newPayments[paymentIndex];
                        const isMatrixPayment = payment.type.startsWith('upline');

                        if (isMatrixPayment) {
                            newPayments[paymentIndex] = { ...payment, status: 'disputed' };
                            usersToPutOnHold.add(payment.receiverId);
                            newDisputes.push(confirmation);
                        } else {
                            // Fix: Corrected undefined variable 'p' to 'payment'.
                            newPayments[paymentIndex] = { ...payment, status: 'unpaid', transactionId: '', proof: null, assignedTimestamp: Date.now() };
                        }
                    }

                    if (newDisputes.length > 0) {
                        setDisputes(prev => [...prev, ...newDisputes]);
                        setAllUsers(prevUsers => prevUsers.map(u => usersToPutOnHold.has(u.id) ? { ...u, status: 'on_hold' } : u));
                    }
                    
                    return newPayments;
                });
            }
        }, 1000);

        return () => clearInterval(confirmationTimerInterval);
    }, [pendingConfirmations]);

    const handleUpdatePayment = (id: string, field: 'transactionId' | 'proof', value: string) => {
        setPaymentsData(prev =>
            prev.map(p => (p.id === id ? { ...p, [field]: value } : p))
        );
    };

    const handleSubmitPayment = (payment: Payment) => {
        setPaymentsData(prev => prev.map(p => p.id === payment.id ? { ...p, status: 'pending' } : p));
        setPendingConfirmations(prev => [
            ...prev,
            {
                id: `conf_${Date.now()}`,
                paymentId: payment.id,
                senderName: profile.name,
                amount: payment.amount,
                transactionId: payment.transactionId,
                proof: payment.proof!,
                date: new Date().toISOString().slice(0, 16).replace('T', ' '),
                type: payment.title,
                submittedTimestamp: Date.now(),
                receiverId: payment.receiverId,
                paymentTitle: payment.title
            }
        ]);
    };
    
    const handleAutoVerify = (payment: Payment) => {
        setPaymentsData(prev => prev.map(p => p.id === payment.id ? { ...p, status: 'verifying' } : p));
        setTimeout(() => {
            const isSuccess = Math.random() > 0.1; // 90% success rate
            if (isSuccess) {
                setPaymentsData(prev => prev.map(p => p.id === payment.id ? { ...p, status: 'confirmed' } : p));
                setTransactionsData(prev => [
                    {
                        date: new Date().toISOString().slice(0, 16).replace('T', ' '),
                        type: payment.type,
                        details: `Auto-verified: ${payment.title}`,
                        amount: payment.amount,
                        status: 'confirmed'
                    },
                    ...prev
                ]);
            } else {
                setPaymentsData(prev => prev.map(p => p.id === payment.id ? { ...p, status: 'failed' } : p));
                setTimeout(() => {
                    setPaymentsData(prev => prev.map(p => p.id === payment.id ? { ...p, status: 'unpaid', transactionId: '' } : p));
                }, 3000);
            }
        }, 3000);
    };

    const handleConfirmPayment = (confirmationId: string) => {
        const confirmation = pendingConfirmations.find(c => c.id === confirmationId);
        if (!confirmation) return;
        setPendingConfirmations(prev => prev.filter(c => c.id !== confirmationId));
        setPaymentsData(prev => prev.map(p => p.id === confirmation.paymentId ? { ...p, status: 'confirmed' } : p));
        setTransactionsData(prev => [
            {
                date: new Date().toISOString().slice(0, 16).replace('T', ' '),
                type: confirmation.type.split(' ')[0].toLowerCase(),
                details: `Payment from ${confirmation.senderName}`,
                amount: confirmation.amount,
                status: 'confirmed'
            },
            ...prev
        ]);
         setNotifications(prev => [{
            id: `n${Date.now()}`,
            type: 'payment_confirmed',
            message: `Your payment for "${confirmation.paymentTitle}" was approved.`,
            timestamp: Date.now(),
            isRead: false
        }, ...prev]);
    };

    const handleRejectPayment = (confirmationId: string) => {
        const confirmation = pendingConfirmations.find(c => c.id === confirmationId);
        if (!confirmation) return;
        setPendingConfirmations(prev => prev.filter(c => c.id !== confirmationId));
        setPaymentsData(prev => prev.map(p => p.id === confirmation.paymentId ? { ...p, status: 'unpaid', transactionId: '', proof: null, assignedTimestamp: Date.now() } : p));
    };

    const handleSelectUser = (user: AdminUser) => {
        setSelectedUser(user);
    };

    const handleCloseUserModal = () => {
        setSelectedUser(null);
    };

    const handleSaveNotes = (userId: string, notes: string) => {
        setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, notes } : u));
    };
    
    const handleResolveDispute = (disputeId: string, favor: 'sender' | 'receiver') => {
        const dispute = disputes.find(d => d.id === disputeId);
        if (!dispute) return;
        
        setDisputes(prev => prev.filter(d => d.id !== disputeId));

        if (favor === 'sender') {
            setPaymentsData(prev => prev.map(p => p.id === dispute.paymentId ? { ...p, status: 'confirmed' } : p));
        } else {
            setPaymentsData(prev => prev.map(p => p.id === dispute.paymentId ? { ...p, status: 'unpaid', transactionId: '', proof: null, assignedTimestamp: Date.now() } : p));
        }
        
        setAllUsers(prevUsers => prevUsers.map(u => u.id === dispute.receiverId ? { ...u, status: 'active' } : u));
    };
    
    const handleViewProof = (proofUrl: string) => {
        setViewingProof(proofUrl);
    };
    
    const handleSaveConfig = (newConfig: SystemConfig) => {
        setSystemConfig(newConfig);
        // NOTE: In a real app, you might want to regenerate payment data or just inform the user that changes will apply to new users.
    };
    
    const handleSaveOptions = (newOptions: AdminPaymentOption[]) => {
        setAdminPaymentOptions(newOptions);
    };
    
    const handleQualifyForBinary = () => {
        setSponsorData(prev => ({
            ...prev,
            directs: prev.directs.map(d => ({ ...d, status: 'paid' }))
        }));
    };

    const handleProcessBinaryQueue = () => {
        const qualifiedUserFound = binaryData.matchingQueue.some(u => u.isQualified);
        if (!qualifiedUserFound) {
            setNotifications(prev => [{
                id: `n${Date.now()}`,
                type: 'system',
                message: 'Binary queue process ran, but no qualified users were found to receive a match.',
                timestamp: Date.now(),
                isRead: false,
            }, ...prev]);
            return;
        }

        setBinaryData(prev => {
            const queue = [...prev.matchingQueue];
            const firstQualifiedIndex = queue.findIndex(user => user.isQualified);

            const winner = queue[firstQualifiedIndex];
            const usersToRequeue = queue.slice(0, firstQualifiedIndex);
            const remainingQueueAfterWinner = queue.slice(firstQualifiedIndex + 1);

            const newQueue = [...remainingQueueAfterWinner, ...usersToRequeue];
            const updatedQueue = newQueue.map((user, index) => ({
                ...user,
                queuePosition: index + 1
            }));

            const newMatch: MatchedPair = {
                pairNumber: prev.matchedPairs.length + prev.pendingPairs.length + 1,
                leftUsers: ['System Match L'],
                rightUsers: ['System Match R'],
                date: new Date().toISOString().slice(0, 16).replace('T', ' '),
                amount: systemConfig.binaryAmount,
                status: 'paid'
            };
            
            const newNotifications: Notification[] = [];
            
            const winnerMessage = winner.id === 'bq_5'
                ? `Congratulations! You received a binary match of ₹${newMatch.amount.toLocaleString()} from the global queue.`
                : `User "${winner.name}" received a binary match from the global queue.`;
            newNotifications.push({ id: `n_win_${Date.now()}`, type: 'income', message: winnerMessage, timestamp: Date.now(), isRead: false });

            usersToRequeue.forEach(user => {
                if (user.id === 'bq_5') { // If current user was skipped
                    newNotifications.push({ id: `n_skip_${Date.now()}`, type: 'system', message: 'You missed a binary match as you were not qualified. You have been moved to the end of the queue.', timestamp: Date.now(), isRead: false });
                }
            });

            setNotifications(prevNots => [...newNotifications, ...prevNots]);
            
            const currentUserNewPosition = updatedQueue.findIndex(u => u.id === 'bq_5') + 1;

            return {
                ...prev,
                matchedPairs: winner.id === 'bq_5' ? [...prev.matchedPairs, newMatch] : prev.matchedPairs,
                matchingQueue: updatedQueue,
                currentUserPosition: currentUserNewPosition > 0 ? currentUserNewPosition : prev.currentUserPosition,
            };
        });
    };

    const handleAiSend = async (message: string) => {
        if (!API_KEY) {
            setAiChatHistory(prev => [...prev, { from: 'ai', text: "I'm sorry, the AI assistant is not configured. An API key is required." }]);
            return;
        }

        setAiChatHistory(prev => [...prev, { from: 'user', text: message }]);
        setIsAiLoading(true);

        try {
            const ai = new GoogleGenAI({ apiKey: API_KEY });
            const model = 'gemini-2.5-flash';
            
            const contextPrompt = `You are a helpful AI assistant for a network marketing platform called Payback247.
            Here is the current user's data summary:
            - Account Status: ${isAccountActive ? 'Active' : 'Pending Activation'}
            - Total Binary Income: ₹${binaryData.matchedPairs.reduce((sum, pair) => sum + pair.amount, 0)}
            - Binary Team: ${binaryData.leftTeam.length} left, ${binaryData.rightTeam.length} right
            The user asked: "${message}"
            Provide a helpful, concise, and encouraging response. Format your response with Markdown.`;
            
            const response = await ai.models.generateContent({
                model,
                contents: contextPrompt
            });

            setAiChatHistory(prev => [...prev, { from: 'ai', text: response.text }]);
        } catch (error) {
            console.error("AI Assistant Error:", error);
            setAiChatHistory(prev => [...prev, { from: 'ai', text: "I'm sorry, I encountered an error. Please try again later." }]);
        } finally {
            setIsAiLoading(false);
        }
    };
    
    const handleMarkNotificationRead = (notificationId: string) => {
        setNotifications(prev =>
            prev.map(n => (n.id === notificationId ? { ...n, isRead: true } : n))
        );
    };

    const handleMarkAllNotificationsRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    };

    const handleResetData = () => {
        const confirmed = window.confirm(
            "Are you sure you want to reset all application data? This will clear everything in your browser's storage for this app and reload the page. This action cannot be undone."
        );
        if (confirmed) {
            localStorage.removeItem(APP_STATE_KEY);
            window.location.reload();
        }
    };
    
    const visibleTabs = ALL_TABS.filter(tab => !tab.admin || isAdmin);
    const activeTabObject = visibleTabs.find(tab => tab.id === activeTab) || visibleTabs[0];

    return (
        <div className="flex h-screen bg-light">
            <SidebarNav
                isOpen={isSidebarOpen}
                onToggle={setIsSidebarOpen}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                visibleTabs={visibleTabs}
                pendingConfirmationsCount={pendingConfirmations.length}
                disputesCount={disputes.length}
            />
            <div className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${isSidebarOpen ? 'lg:ml-64' : 'lg:ml-20'}`}>
                <Header 
                    onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                    activeTabLabel={activeTabObject.label}
                    isAdmin={isAdmin}
                    onToggleAdmin={setIsAdmin}
                    notifications={notifications}
                    onMarkAsRead={handleMarkNotificationRead}
                    onMarkAllAsRead={handleMarkAllNotificationsRead}
                />
                <main className="flex-1 overflow-y-auto p-4 sm:p-6">
                    {activeTab === 'dashboard' && <DashboardTab matrixData={initialMatrixData} binaryData={binaryData} sponsorData={sponsorData} onTabChange={setActiveTab} isAccountActive={isAccountActive} isQualifiedForBinary={isQualifiedForBinary} />}
                    {activeTab === 'join' && <JoinTab payments={paymentsData} onUpdatePayment={handleUpdatePayment} onSubmitPayment={handleSubmitPayment} onAutoVerify={handleAutoVerify} />}
                    {activeTab === 'confirmations' && <ConfirmationsTab confirmations={pendingConfirmations} onConfirm={handleConfirmPayment} onReject={handleRejectPayment} />}
                    {activeTab === 'matrix' && <MatrixTab />}
                    {activeTab === 'binary' && <BinaryTab binaryData={binaryData} sponsorData={sponsorData} isQualifiedForBinary={isQualifiedForBinary} onQualify={handleQualifyForBinary} onProcessQueue={handleProcessBinaryQueue} />}
                    {activeTab === 'sponsor' && <SponsorTab sponsorData={sponsorData} />}
                    {activeTab === 'transactions' && <TransactionsTab transactions={transactionsData} />}
                    {activeTab === 'profile' && <ProfileTab profile={profile} onProfileChange={setProfile} />}
                    {activeTab === 'admin' && isAdmin && <AdminTab users={allUsers} onSelectUser={handleSelectUser} />}
                    {activeTab === 'disputes' && isAdmin && <DisputesTab disputes={disputes} onResolveSender={(id) => handleResolveDispute(id, 'sender')} onResolveReceiver={(id) => handleResolveDispute(id, 'receiver')} allUsers={allUsers} onViewProof={handleViewProof}/>}
                    {activeTab === 'config' && isAdmin && <SystemConfigTab systemConfig={systemConfig} onSaveConfig={handleSaveConfig} adminPaymentOptions={adminPaymentOptions} onSaveOptions={handleSaveOptions} onResetData={handleResetData} />}
                </main>
            </div>
            {selectedUser && <UserDetailModal user={selectedUser} onClose={handleCloseUserModal} onSaveNotes={handleSaveNotes} />}
            <ProofModal isOpen={!!viewingProof} onClose={() => setViewingProof(null)} proofUrl={viewingProof} />

            <button onClick={() => setIsAiAssistantOpen(true)} className="ai-fab" title="AI Growth Advisor">
                <i className="fas fa-robot"></i>
            </button>
            <AIAssistant
                isOpen={isAiAssistantOpen}
                onClose={() => setIsAiAssistantOpen(false)}
                history={aiChatHistory}
                onSend={handleAiSend}
                isLoading={isAiLoading}
                onSuggestionClick={(suggestion) => handleAiSend(suggestion)}
            />
        </div>
    );
};

export default Home;