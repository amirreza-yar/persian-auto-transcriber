import * as React from "react";
import {
  KeyRoundIcon,
  MoonIcon,
  PlusIcon,
  RefreshCcwIcon,
  Settings2Icon,
  SunIcon,
  Trash2Icon,
  WifiIcon,
} from "lucide-react";
import { toast } from "sonner";

import { normalizeApiError } from "@/api/client";
import { getSettings, updateSettings } from "@/api/settings";
import { getCircuits, resetCircuit } from "@/api/system";
import { deleteToken, listTokens, updateToken } from "@/api/tokens";
import { useTheme } from "@/app/theme-provider";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageHeader } from "@/components/common/page-header";
import { SettingRow } from "@/components/common/setting-row";
import { TokenDialog } from "@/components/settings/token-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/format";
import type {
  ApiToken,
  CircuitBreaker,
  RuntimeSettingValue,
  RuntimeSettings,
} from "@/types/api";
import { usePwaInstall } from "@/hooks/use-pwa-install";

function numberValue(settings: RuntimeSettings, key: string, fallback = 0) {
  const value = settings[key];
  return typeof value === "number" ? value : fallback;
}

function stringValue(settings: RuntimeSettings, key: string) {
  const value = settings[key];
  return typeof value === "string" ? value : "";
}

function booleanValue(settings: RuntimeSettings, key: string) {
  return settings[key] === true;
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = React.useState<RuntimeSettings | null>(null);
  const [tokens, setTokens] = React.useState<ApiToken[]>([]);
  const [circuits, setCircuits] = React.useState<CircuitBreaker[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tokenDialogOpen, setTokenDialogOpen] = React.useState(false);
  const [deleteTokenTarget, setDeleteTokenTarget] =
    React.useState<ApiToken | null>(null);
  const [busy, setBusy] = React.useState(false);

  const {
    installed: isPWAInstalled,
    canInstall: canInstallPWA,
    install: installPWA,
  } = usePwaInstall();

  const load = React.useCallback(async () => {
    try {
      const [settingsData, tokenData, circuitData] = await Promise.all([
        getSettings(),
        listTokens(),
        getCircuits(),
      ]);
      setSettings(settingsData);
      setTokens(tokenData);
      setCircuits(circuitData);
    } catch (error) {
      toast.error(normalizeApiError(error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = async (
    values: Record<string, RuntimeSettingValue>,
    message = "Settings saved.",
  ) => {
    setBusy(true);
    try {
      const updated = await updateSettings(values);
      setSettings(updated);
      toast.success(message);
      return true;
    } catch (error) {
      toast.error(normalizeApiError(error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const geminiCircuit = circuits.find((circuit) => circuit.name === "gemini");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Defaults for future jobs. Most users never need to change these."
      />

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            The application shell stays English and LTR. Persian transcript
            content uses RTL automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            title="Theme"
            description="Use a light theme, dark theme or follow this device."
          >
            <Select
              value={theme}
              onValueChange={(value) =>
                setTheme(value as "light" | "dark" | "system")
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">
                  <span className="flex items-center gap-2">
                    <SunIcon className="size-4" />
                    Light
                  </span>
                </SelectItem>
                <SelectItem value="dark">
                  <span className="flex items-center gap-2">
                    <MoonIcon className="size-4" />
                    Dark
                  </span>
                </SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          {!isPWAInstalled && (
            <SettingRow
              title="Install PWA"
              description="Install PWA to achieve maximum app features"
            >
              <Button size="lg" className="w-full" onClick={installPWA}>
                Install app
              </Button>
            </SettingRow>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcription</CardTitle>
          <CardDescription>
            Default Whisper settings for newly uploaded recordings.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <TextSetting
            label="Model"
            description="Whisper model loaded by the transcription worker."
            value={stringValue(settings, "transcription.model")}
            disabled={busy}
            onSave={(value) => save({ "transcription.model": value })}
          />
          <NumberSetting
            label="Chunk length"
            description="Seconds of core audio processed per chunk."
            value={numberValue(settings, "transcription.core_seconds", 60)}
            suffix="seconds"
            disabled={busy}
            onSave={(value) => save({ "transcription.core_seconds": value })}
          />
          <details className="group py-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium">
              <Settings2Icon className="text-muted-foreground size-4" />
              Advanced transcription settings
            </summary>
            <div className="divide-y pl-1">
              <NumberSetting
                label="Context"
                description="Overlap around each core chunk."
                value={numberValue(
                  settings,
                  "transcription.context_seconds",
                  2,
                )}
                suffix="seconds"
                disabled={busy}
                onSave={(value) =>
                  save({ "transcription.context_seconds": value })
                }
              />
              <NumberSetting
                label="CPU threads"
                value={numberValue(settings, "transcription.cpu_threads", 4)}
                disabled={busy}
                onSave={(value) => save({ "transcription.cpu_threads": value })}
              />
              <NumberSetting
                label="Beam size"
                value={numberValue(settings, "transcription.beam_size", 5)}
                disabled={busy}
                onSave={(value) => save({ "transcription.beam_size": value })}
              />
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cleanup</CardTitle>
          <CardDescription>
            Gemini corrects transcription errors and prepares readable
            paragraphs after Whisper finishes.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <SettingRow
            title="Clean transcripts"
            description="When disabled, jobs finish with the normalized Whisper text."
          >
            <Switch
              checked={booleanValue(settings, "cleaning.enabled")}
              onCheckedChange={(checked) =>
                void save(
                  { "cleaning.enabled": checked },
                  checked ? "Cleanup enabled." : "Cleanup disabled.",
                )
              }
              disabled={busy}
            />
          </SettingRow>
          <TextSetting
            label="Gemini model"
            value={stringValue(settings, "cleaning.model")}
            disabled={busy}
            onSave={(value) => save({ "cleaning.model": value })}
          />
          <NumberSetting
            label="Text chunk size"
            description="Maximum approximate characters per Gemini cleanup request."
            value={numberValue(settings, "cleaning.chunk_chars", 3500)}
            suffix="chars"
            disabled={busy}
            onSave={(value) => save({ "cleaning.chunk_chars": value })}
          />
          <details className="group py-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium">
              <Settings2Icon className="text-muted-foreground size-4" />
              Advanced cleanup settings
            </summary>
            <div className="divide-y pl-1">
              <NumberSetting
                label="Request retries"
                value={numberValue(settings, "cleaning.retry_count", 4)}
                disabled={busy}
                onSave={(value) => save({ "cleaning.retry_count": value })}
              />
              <NumberSetting
                label="Retry delay"
                value={numberValue(settings, "cleaning.retry_base_seconds", 15)}
                suffix="seconds"
                disabled={busy}
                onSave={(value) =>
                  save({ "cleaning.retry_base_seconds": value })
                }
              />
              <NumberSetting
                label="Request timeout"
                value={numberValue(
                  settings,
                  "cleaning.request_timeout_seconds",
                  120,
                )}
                suffix="seconds"
                disabled={busy}
                onSave={(value) =>
                  save({ "cleaning.request_timeout_seconds": value })
                }
              />
              <NumberSetting
                label="Token cooldown"
                value={numberValue(
                  settings,
                  "cleaning.token_cooldown_seconds",
                  300,
                )}
                suffix="seconds"
                disabled={busy}
                onSave={(value) =>
                  save({ "cleaning.token_cooldown_seconds": value })
                }
              />
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <CardTitle>Gemini tokens</CardTitle>
            <CardDescription className="mt-1.5">
              Credentials used by the cleanup worker.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setTokenDialogOpen(true)}>
            <PlusIcon />
            Add token
          </Button>
        </CardHeader>
        <CardContent>
          {tokens.length ? (
            <div className="divide-y">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <KeyRoundIcon className="text-muted-foreground size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{token.label}</p>
                      <Badge variant="outline">priority {token.priority}</Badge>
                      {token.cooldown_until ? (
                        <Badge variant="outline">cooldown</Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {token.masked_token} ·{" "}
                      {formatNumber(token.total_tokens_today)} tokens today ·{" "}
                      {formatNumber(token.requests_today)} requests
                    </p>
                    {token.last_error ? (
                      <p className="text-destructive mt-1 line-clamp-1 text-xs">
                        {token.last_error}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Switch
                      checked={token.enabled}
                      onCheckedChange={async (checked) => {
                        try {
                          const updated = await updateToken(token.id, {
                            enabled: checked,
                          });
                          setTokens((current) =>
                            current.map((item) =>
                              item.id === updated.id ? updated : item,
                            ),
                          );
                        } catch (error) {
                          toast.error(normalizeApiError(error).message);
                        }
                      }}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${token.label}`}
                      onClick={() => setDeleteTokenTarget(token)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No Gemini tokens have been added.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Network</CardTitle>
          <CardDescription>
            Optional SOCKS5 route used by network-dependent cleanup requests.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proxy-url">SOCKS5 proxy</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="proxy-url"
                defaultValue={stringValue(settings, "network.proxy_url")}
                placeholder="socks5://host.docker.internal:9004"
                className="flex-1"
                onKeyDown={(event) => {
                  if (event.key === "Enter")
                    void save({
                      "network.proxy_url": event.currentTarget.value.trim(),
                    });
                }}
              />
              <Button
                variant="outline"
                onClick={(event) => {
                  const input =
                    event.currentTarget.parentElement?.querySelector("input");
                  if (input)
                    void save({ "network.proxy_url": input.value.trim() });
                }}
                disabled={busy}
              >
                <WifiIcon />
                Save proxy
              </Button>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Gemini circuit</p>
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {geminiCircuit?.last_error || "No recent provider error"}
              </p>
            </div>
            <Badge
              variant={
                geminiCircuit?.state === "open" ? "destructive" : "secondary"
              }
              className="capitalize"
            >
              {geminiCircuit?.state ?? "unknown"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await resetCircuit("gemini");
                  setCircuits(await getCircuits());
                  toast.success("Gemini circuit reset.");
                } catch (error) {
                  toast.error(normalizeApiError(error).message);
                }
              }}
            >
              <RefreshCcwIcon />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced server defaults</CardTitle>
          <CardDescription>
            Queue, validation and circuit-breaker settings. Leave these alone
            unless you are diagnosing the server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer py-2 text-sm font-medium">
              Show advanced settings
            </summary>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              {[
                ["worker.poll_seconds", "Worker poll interval"],
                ["worker.max_attempts", "Worker max attempts"],
                ["worker.retry_base_seconds", "Worker retry delay"],
                ["worker.stale_after_seconds", "Stale worker threshold"],
                ["upload.max_bytes", "Maximum upload bytes"],
                ["upload.max_duration_seconds", "Maximum audio seconds"],
                [
                  "circuit.gemini.failure_threshold",
                  "Circuit failure threshold",
                ],
                ["circuit.gemini.cooldown_seconds", "Circuit cooldown seconds"],
                ["system.stream_interval_seconds", "System stream interval"],
              ].map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label>{label}</Label>
                  <Input
                    type="number"
                    defaultValue={String(settings[key] ?? "")}
                    onBlur={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value) && value !== settings[key])
                        void save({ [key]: value });
                    }}
                  />
                </div>
              ))}
            </div>
          </details>
        </CardContent>
      </Card>

      <TokenDialog
        open={tokenDialogOpen}
        onOpenChange={setTokenDialogOpen}
        onCreated={(created) =>
          setTokens((current) =>
            [...current, created].sort((a, b) => b.priority - a.priority),
          )
        }
      />
      <ConfirmDialog
        open={deleteTokenTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTokenTarget(null);
        }}
        title="Delete this Gemini token?"
        description="The credential will be removed from the local server. Other tokens are not affected."
        confirmLabel="Delete token"
        destructive
        onConfirm={async () => {
          if (!deleteTokenTarget) return;
          try {
            await deleteToken(deleteTokenTarget.id);
            setTokens((current) =>
              current.filter((item) => item.id !== deleteTokenTarget.id),
            );
            setDeleteTokenTarget(null);
            toast.success("Token deleted.");
          } catch (error) {
            toast.error(normalizeApiError(error).message);
          }
        }}
      />
    </div>
  );
}

function TextSetting({
  label,
  description,
  value,
  disabled,
  onSave,
}: {
  label: string;
  description?: string;
  value: string;
  disabled: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  return (
    <SettingRow title={label} description={description}>
      <div className="flex w-full gap-2 sm:w-80">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={disabled}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || draft.trim() === value}
          onClick={() => void onSave(draft.trim())}
        >
          Save
        </Button>
      </div>
    </SettingRow>
  );
}

function NumberSetting({
  label,
  description,
  value,
  suffix,
  disabled,
  onSave,
}: {
  label: string;
  description?: string;
  value: number;
  suffix?: string;
  disabled: boolean;
  onSave: (value: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  return (
    <SettingRow title={label} description={description}>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-28"
          disabled={disabled}
        />
        {suffix ? (
          <span className="text-muted-foreground text-xs">{suffix}</span>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={
            disabled ||
            Number(draft) === value ||
            !Number.isFinite(Number(draft))
          }
          onClick={() => void onSave(Number(draft))}
        >
          Save
        </Button>
      </div>
    </SettingRow>
  );
}
