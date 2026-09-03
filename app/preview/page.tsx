export const metadata = {
  title: "序｜內部外觀預覽",
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  return (
    <main className="preview-stage">
      <iframe
        className="app-shell-frame"
        src="/shell/index.html#/auth/welcome"
        title="序｜內部外觀預覽"
        allow="fullscreen"
      />
    </main>
  );
}
