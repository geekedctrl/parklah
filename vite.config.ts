import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins:[react(),tailwindcss()],
  server:{
    proxy:{'/api':{target:process.env.VITE_API_PROXY??'http://127.0.0.1:8000',changeOrigin:true}},
  },
  build:{
    rolldownOptions:{
      output:{
        codeSplitting:{
          groups:[
            {name:'react-vendor',test:/node_modules[\\/](react|react-dom|scheduler|react-router|@remix-run)[\\/]/,priority:30},
            {name:'chart-vendor',test:/node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/,priority:25},
            {name:'motion-vendor',test:/node_modules[\\/]framer-motion[\\/]/,priority:20},
            {name:'icon-vendor',test:/node_modules[\\/]lucide-react[\\/]/,priority:15},
          ],
        },
      },
    },
  },
});
