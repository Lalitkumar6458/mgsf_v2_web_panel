// Hidden developer page — keep it out of search engines and link previews.
export const metadata = { title: "Control", robots: { index: false, follow: false, nocache: true } };
export default function Layout({ children }) { return children; }
