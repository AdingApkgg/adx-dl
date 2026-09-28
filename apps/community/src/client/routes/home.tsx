import { m } from "@/paraglide/messages.js";

export default function Home() {
  return (
    <main>
      <h1>{m.site_name()}</h1>
      <p>{m.home_description()}</p>
    </main>
  );
}
