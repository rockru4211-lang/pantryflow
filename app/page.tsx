export default function Home() {
  return (
    <main className="preview-stage">
      <iframe
        className="app-shell-frame"
        src="/shell/index.html#/auth/welcome"
        title="PantryFlow 完整 App 外殼預覽"
        allow="fullscreen"
      />
    </main>
  );
}
