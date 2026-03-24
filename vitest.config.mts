import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'app/src')
        }
    },
    test: {
        environment: 'jsdom',
        include: ['test/ui/**/*.test.tsx'],
        globals: true,
        setupFiles: ['test/ui/setup.ts']
    }
});
