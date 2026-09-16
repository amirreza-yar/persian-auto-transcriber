// src/hooks/use-pwa-install.ts

import { useEffect, useState } from "react"
import type { BeforeInstallPromptEvent } from "@/types/pwa"

function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches
}

export function usePwaInstall() {
    const [installEvent, setInstallEvent] =
        useState<BeforeInstallPromptEvent | null>(null)

    const [installed, setInstalled] = useState(isStandalone())

    useEffect(() => {
        const handleBeforeInstall = (event: Event) => {
            event.preventDefault()

            setInstallEvent(event as BeforeInstallPromptEvent)
        }

        const handleInstalled = () => {
            setInstalled(true)
            setInstallEvent(null)
        }

        window.addEventListener(
            "beforeinstallprompt",
            handleBeforeInstall
        )

        window.addEventListener(
            "appinstalled",
            handleInstalled
        )

        const media = window.matchMedia(
            "(display-mode: standalone)"
        )

        const handleDisplayMode = () => {
            setInstalled(media.matches)
        }

        media.addEventListener("change", handleDisplayMode)

        return () => {
            window.removeEventListener(
                "beforeinstallprompt",
                handleBeforeInstall
            )

            window.removeEventListener(
                "appinstalled",
                handleInstalled
            )

            media.removeEventListener(
                "change",
                handleDisplayMode
            )
        }
    }, [])

    const install = async () => {
        if (!installEvent) {
            return false
        }

        await installEvent.prompt()

        const result = await installEvent.userChoice

        if (result.outcome === "accepted") {
            setInstallEvent(null)
            return true
        }

        return false
    }

    return {
        installed,
        canInstall: installEvent !== null,
        install,
    }
}