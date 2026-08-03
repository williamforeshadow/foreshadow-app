# Foreshadow App

A modern web application built with Next.js 16, Tailwind CSS v4, and Supabase.

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ installed
- Supabase account and project

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   
   Create a `.env.local` file in the root directory:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
foreshadow-app/
├── app/                    # Next.js App Router
│   ├── dashboard/         # Dashboard page
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── globals.css        # Global styles
├── components/            # Reusable components
│   └── Navigation.tsx     # Navigation component
├── lib/                   # Utility functions
│   └── supabaseClient.ts  # Supabase client config
└── public/                # Static assets
```

## 🛠️ Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS v4
- **Database:** Supabase
- **Language:** TypeScript
- **Font:** Geist Sans & Geist Mono

## ✨ Features

- ⚡ Lightning-fast performance with Next.js 16
- 🎨 Modern, responsive UI with Tailwind CSS v4
- ☀️ Light-mode UI — a single fixed theme, no per-user toggle
- 🔐 Pre-configured Supabase integration
- 📱 Mobile-friendly responsive design
- 🎯 TypeScript for type safety

## 📝 Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

### Adding New Pages

Create a new folder in the `app` directory with a `page.tsx` file:

```typescript
// app/new-page/page.tsx
export default function NewPage() {
  return (
    <div>
      <h1>New Page</h1>
    </div>
  );
}
```

### Using Supabase

The Supabase client is already configured in `lib/supabaseClient.ts`. Import and use it:

```typescript
import { supabase } from '@/lib/supabaseClient';

// Example: Fetch data
const { data, error } = await supabase
  .from('your_table')
  .select('*');
```

## 🎨 Customization

### Colors

Edit colors in `app/globals.css`:

```css
:root {
  --background: #ffffff;
  --foreground: #0f172a;
}
```

### Fonts

Update fonts in `app/layout.tsx` using Next.js font optimization.

## 📦 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import your repository on [Vercel](https://vercel.com)
3. Add your environment variables
4. Deploy!

### Other Platforms

Build the production bundle:

```bash
npm run build
```

Then start the server:

```bash
npm start
```

## 📄 License

MIT

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.
