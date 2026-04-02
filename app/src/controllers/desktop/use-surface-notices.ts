import { useState } from 'react';
import type { SurfaceNotice, SurfaceNoticeScope, SurfaceNoticeTone } from './types';

export function useSurfaceNotices() {
    const [surfaceNotices, setSurfaceNotices] = useState<Partial<Record<SurfaceNoticeScope, SurfaceNotice>>>({});

    function setSurfaceNotice(scope: SurfaceNoticeScope, tone: SurfaceNoticeTone, message: string) {
        setSurfaceNotices((previous) => ({
            ...previous,
            [scope]: {
                tone,
                message
            }
        }));
    }

    return {
        surfaceNotices,
        setSurfaceNotice
    };
}
