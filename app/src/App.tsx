import { AppShell } from '@/app-shell/AppShell';
import { useDesktopController } from '@/controllers/desktop/use-desktop-controller';

export default function App() {
    const controller = useDesktopController();
    return <AppShell controller={controller} />;
}
