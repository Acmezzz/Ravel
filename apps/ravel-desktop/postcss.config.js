/** PostCSS pipeline: Tailwind 4 + autoprefixer. */
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";

export default {
  plugins: [tailwindcss(), autoprefixer()],
};
