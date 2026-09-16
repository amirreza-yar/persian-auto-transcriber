import { createBrowserRouter } from "react-router-dom"

import { AppShell } from "@/components/layout/app-shell"
import { AudioPlayerPage } from "@/pages/AudioPlayerPage"
import { FilesPage } from "@/pages/FilesPage"
import { HomePage } from "@/pages/HomePage"
import { SettingsPage } from "@/pages/SettingsPage"
import { StatisticsPage } from "@/pages/StatisticsPage"
import { TextViewerPage } from "@/pages/TextViewerPage"

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/files", element: <FilesPage /> },
      { path: "/statistics", element: <StatisticsPage /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
  { path: "/player/:jobId", element: <AudioPlayerPage /> },
  { path: "/text/:jobId", element: <TextViewerPage /> },
])
