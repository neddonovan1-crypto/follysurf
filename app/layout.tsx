import type { Metadata } from "next";
export const metadata: Metadata = {title:"Folly Surf",description:"Folly Beach surf forecasts, wind, tides and traffic."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
