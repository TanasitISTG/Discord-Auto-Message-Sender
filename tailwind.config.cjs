/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class'],
    content: ['./app/index.html', './app/src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                border: 'hsl(var(--border))',
                card: 'hsl(var(--card))',
                'card-foreground': 'hsl(var(--card-foreground))',
                muted: 'hsl(var(--muted))',
                'muted-foreground': 'hsl(var(--muted-foreground))',
                primary: 'hsl(var(--primary))',
                'primary-foreground': 'hsl(var(--primary-foreground))',
                accent: 'hsl(var(--accent))',
                'accent-foreground': 'hsl(var(--accent-foreground))',
                danger: 'hsl(var(--danger))'
            },
            borderRadius: {
                xl: '1rem',
                '2xl': '1.25rem'
            },
            boxShadow: {
                glow: '0 0 0 1px rgba(82, 183, 255, 0.15), 0 16px 40px rgba(0, 0, 0, 0.35)'
            }
        }
    },
    plugins: []
};
