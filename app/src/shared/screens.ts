import { Info, LayoutDashboard, Logs, Play, Settings2, Shuffle } from 'lucide-react';
import { ComponentType } from 'react';

export type Screen = 'dashboard' | 'config' | 'preview' | 'session' | 'logs' | 'support';

export interface NavigationItem {
    id: Screen;
    label: string;
    icon: ComponentType<{ className?: string }>;
}

export const navigation: NavigationItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'config', label: 'Config', icon: Settings2 },
    { id: 'preview', label: 'Dry Run', icon: Shuffle },
    { id: 'session', label: 'Session', icon: Play },
    { id: 'logs', label: 'Logs', icon: Logs },
    { id: 'support', label: 'Support', icon: Info },
];
