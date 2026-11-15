// Settings tab for custom alert rules, webhooks, and daily digest.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { InfoIcon, PlusIcon, TrashIcon, TestTubeIcon } from "lucide-react";
import { SectionLabel, SettingRow, triggerClass, selectContentClass, selectItemClass } from "./settingsChrome";
import { useCustomRules, useWebhookSettings, type CustomAlertRule, type WebhookConfig } from "../../hooks/useCustomAlerts";
import { METRIC_BOUNDS, MAX_DURATION_SECONDS, type CustomAlertMetric, type CustomAlertCondition } from "@core/customAlertRules";
import { validateWebhookUrl } from "@core/webhookDelivery";

/** Static labels for each metric — avoids dynamic t() key lookup that TS can't type-check. */
const METRIC_LABELS: Record<CustomAlertMetric, string> = {
  downloadMbps: "Download",
  uploadMbps: "Upload",
  latencyMs: "Latency",
  pingSuccessPercent: "Ping success",
  powerWatts: "Power draw",
  obstructionPercent: "Sky obstruction",
};

interface RuleFormState {
  id: string;
  name: string;
  metric: CustomAlertMetric;
  condition: CustomAlertCondition;
  threshold: string;
  durationSeconds: string;
  enabled: boolean;
  isNew: boolean;
}

function newRuleForm(): RuleFormState {
  return {
    id: crypto.randomUUID(),
    name: "",
    metric: "downloadMbps",
    condition: "below",
    threshold: "",
    durationSeconds: "0",
    enabled: true,
    isNew: true,
  };
}

function ruleToForm(rule: CustomAlertRule): RuleFormState {
  return {
    id: rule.id,
    name: rule.name,
    metric: rule.metric,
    condition: rule.condition,
    threshold: String(rule.threshold),
    durationSeconds: String(rule.durationSeconds),
    enabled: rule.enabled,
    isNew: false,
  };
}

function WebhookSettingsSection({
  settings,
  setWebhook,
  testWebhook,
  loading,
  error,
}: ReturnType<typeof useWebhookSettings>) {
  const { t } = useTranslation();
  const [editWebhookUrl, setEditWebhookUrl] = useState("");
  const [editBuiltinAlerts, setEditBuiltinAlerts] = useState(false);
  const [editCustomAlerts, setEditCustomAlerts] = useState(false);
  const [editDigestWebhook, setEditDigestWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<boolean | null>(null);
  const [webhookUrlError, setWebhookUrlError] = useState<string | null>(null);

  // Sync local edit state with fetched settings when they change.
  // This happens on initial load and after a successful save/load.
  useEffect(() => {
    setEditWebhookUrl(settings.webhook?.url ?? "");
    setEditBuiltinAlerts(settings.webhook?.builtinAlerts ?? false);
    setEditCustomAlerts(settings.webhook?.customAlerts ?? false);
    setEditDigestWebhook(settings.webhook?.digest ?? false);
  }, [settings]);

  const handleSaveWebhook = async () => {
    setWebhookUrlError(null);
    const validationError = validateWebhookUrl(editWebhookUrl);
    if (editWebhookUrl !== "" && validationError) {
      setWebhookUrlError(validationError);
      return;
    }

    const newConfig: WebhookConfig | null = editWebhookUrl === "" ? null : {
      url: editWebhookUrl,
      builtinAlerts: editBuiltinAlerts,
      customAlerts: editCustomAlerts,
      digest: editDigestWebhook,
    };
    await setWebhook(newConfig);
  };

  const handleTestWebhook = async () => {
    setWebhookTestResult(null);
    const ok = await testWebhook();
    setWebhookTestResult(ok);
  };

  if (loading) return null; // Or a loading spinner

  return (
    <div className='flex flex-col gap-4'>
      <SectionLabel>{t("settings.webhookNotifications")}</SectionLabel>

      <SettingRow
        title={t("settings.webhookUrl")}
        caption={t("settings.webhookUrlDesc")}
        info={t("settings.webhookUrlInfo")}
        note={webhookUrlError && <Callout tone='error' icon='warning'>{webhookUrlError}</Callout>}
      >
        <Input
          value={editWebhookUrl}
          onChange={(e) => setEditWebhookUrl(e.target.value)}
          placeholder="https://hooks.slack.com/… or https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>"
          className="w-[300px]"
        />
      </SettingRow>

      {settings.webhook && (
        <div className='flex flex-col gap-2 pl-4'>
          <SettingRow
            title={t("settings.notifyBuiltinAlerts")}
            caption={t("settings.notifyBuiltinAlertsDesc")}
          >
            <Switch checked={editBuiltinAlerts} onCheckedChange={setEditBuiltinAlerts} />
          </SettingRow>
          <SettingRow
            title={t("settings.notifyCustomAlerts")}
            caption={t("settings.notifyCustomAlertsDesc")}
          >
            <Switch checked={editCustomAlerts} onCheckedChange={setEditCustomAlerts} />
          </SettingRow>
          <SettingRow
            title={t("settings.notifyDailyDigest")}
            caption={t("settings.notifyDailyDigestDesc")}
          >
            <Switch checked={editDigestWebhook} onCheckedChange={setEditDigestWebhook} />
          </SettingRow>
        </div>
      )}

      <div className='flex justify-end gap-2'>
        {settings.webhook && (
          <Button variant='outline' size='sm' onClick={handleTestWebhook} className='flex items-center gap-2'>
            <TestTubeIcon size={16} /> {t("common.test")}
          </Button>
        )}
        {webhookTestResult !== null && (
          <Callout tone={webhookTestResult ? 'info' : 'error'} className='flex items-center gap-2'>
            {webhookTestResult ? t("settings.webhookTestSuccess") : t("settings.webhookTestFailure")}
          </Callout>
        )}
        <Button size='sm' onClick={handleSaveWebhook} disabled={loading}>
          {t("common.save")}
        </Button>
      </div>

      {error && <Callout tone='error' icon='warning'>{t("common.failed", { message: error })}</Callout>}
    </div>
  );
}

function DailyDigestSettingsSection({
  settings,
  setDigest,
  loading,
  error,
}: Pick<ReturnType<typeof useWebhookSettings>, "settings" | "setDigest" | "loading" | "error">) {
  const { t } = useTranslation();
  const [editEnabled, setEditEnabled] = useState(settings.digest.enabled);
  // Store hour as a plain number string ("8", not "08") to match option values.
  const [editHour, setEditHour] = useState(String(settings.digest.hourOfDay));

  useEffect(() => {
    setEditEnabled(settings.digest.enabled);
    setEditHour(String(settings.digest.hourOfDay));
  }, [settings.digest.enabled, settings.digest.hourOfDay]);

  const handleSaveDigest = async () => {
    await setDigest({ enabled: editEnabled, hourOfDay: Number(editHour) });
  };

  if (loading) return null;

  // Values are plain number strings ("0"–"23") so they match editHour exactly.
  const hours = Array.from({ length: 24 }, (_, i) => String(i));

  return (
    <div className='flex flex-col gap-4'>
      <SectionLabel>{t("settings.dailyDigest")}</SectionLabel>

      <SettingRow
        title={t("settings.enableDailyDigest")}
        caption={t("settings.enableDailyDigestDesc")}
      >
        <Switch checked={editEnabled} onCheckedChange={setEditEnabled} />
      </SettingRow>

      {editEnabled && (
        <SettingRow
          title={t("settings.digestHour")}
          caption={t("settings.digestHourDesc")}
          info={t("settings.digestHourInfo")}
        >
          <Select value={editHour} onValueChange={setEditHour}>
            <SelectTrigger className={triggerClass} style={{ width: 80 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={selectContentClass}>
              {hours.map((h) => (
                <SelectItem key={h} value={h} className={selectItemClass}>
                  {h.padStart(2, "0")}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      )}

      <div className='flex justify-end'>
        <Button size='sm' onClick={handleSaveDigest} disabled={loading}>
          {t("common.save")}
        </Button>
      </div>

      {error && <Callout tone='error' icon='warning'>{t("common.failed", { message: error })}</Callout>}
    </div>
  );
}

function CustomRuleEditor({ rule: initialRule, onCancel, onSave }: {
  rule: RuleFormState;
  onCancel: () => void;
  onSave: (rule: CustomAlertRule) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [rule, setRule] = useState(initialRule);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  // Sync rule state for editing after initialRule changes (e.g. when editing a new rule)
  useEffect(() => {
    setRule(initialRule);
    setErrors({}); // Clear errors when rule changes
  }, [initialRule]);

  const validateAndSave = async () => {
    const newErrors: Record<string, string | null> = {};
    let hasError = false;

    if (rule.name.trim() === "") {
      newErrors.name = t("settings.ruleNameRequired");
      hasError = true;
    }

    const thresholdNum = Number(rule.threshold);
    if (!Number.isFinite(thresholdNum)) {
      newErrors.threshold = t("settings.thresholdInvalid");
      hasError = true;
    } else {
      const bounds = METRIC_BOUNDS[rule.metric];
      if (thresholdNum < bounds.min || thresholdNum > bounds.max) {
        newErrors.threshold = t("settings.thresholdOutOfBounds", { min: bounds.min, max: bounds.max, unit: bounds.unit });
        hasError = true;
      }
    }

    const durationNum = Number(rule.durationSeconds);
    if (!Number.isInteger(durationNum) || durationNum < 0 || durationNum > MAX_DURATION_SECONDS) {
      newErrors.durationSeconds = t("settings.durationInvalid", { max: MAX_DURATION_SECONDS });
      hasError = true;
    }

    setErrors(newErrors);
    if (hasError) return;

    await onSave({
      id: rule.id,
      name: rule.name.trim(),
      metric: rule.metric,
      condition: rule.condition,
      threshold: thresholdNum,
      durationSeconds: durationNum,
      enabled: rule.enabled,
    });
    onCancel(); // Close editor on successful save
  };

  const metricBounds = METRIC_BOUNDS[rule.metric];

  return (
    <div className='flex flex-col gap-4 p-4 border rounded-lg bg-card-muted'>
      <SettingRow title={t("settings.ruleName")}>
        <Input
          value={rule.name}
          onChange={(e) => setRule({ ...rule, name: e.target.value })}
          placeholder={t("settings.ruleNamePlaceholder")}
          className="w-[250px]"
        />
      </SettingRow>
      {errors.name && <Callout tone='error' icon='warning'>{errors.name}</Callout>}

      <SettingRow title={t("settings.metric")}>
        <Select
          value={rule.metric}
          onValueChange={(value) => setRule({ ...rule, metric: value as CustomAlertMetric, threshold: "" })}
        >
          <SelectTrigger className={triggerClass} style={{ width: 180 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            {(Object.keys(METRIC_BOUNDS) as CustomAlertMetric[]).map((m) => (
              <SelectItem key={m} value={m} className={selectItemClass}>
                {METRIC_LABELS[m] ?? m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow title={t("settings.condition")}>
        <Select
          value={rule.condition}
          onValueChange={(value) => setRule({ ...rule, condition: value as CustomAlertCondition })}
        >
          <SelectTrigger className={triggerClass} style={{ width: 120 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value="above" className={selectItemClass}>{t("settings.conditionAbove")}</SelectItem>
            <SelectItem value="below" className={selectItemClass}>{t("settings.conditionBelow")}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow title={t("settings.threshold")}>
        <Input
          type="number"
          value={rule.threshold}
          onChange={(e) => setRule({ ...rule, threshold: e.target.value })}
          placeholder={String(metricBounds.min)}
          min={metricBounds.min}
          max={metricBounds.max}
          step={metricBounds.step}
          className="w-[120px]"
        />
        <span className="text-sm text-muted-foreground">{metricBounds.unit}</span>
      </SettingRow>
      {errors.threshold && <Callout tone='error' icon='warning'>{errors.threshold}</Callout>}

      <SettingRow
        title={t("settings.durationSeconds")}
        caption={t("settings.durationSecondsDesc")}
        info={t("settings.durationSecondsInfo", { max: MAX_DURATION_SECONDS })}
      >
        <Input
          type="number"
          value={rule.durationSeconds}
          onChange={(e) => setRule({ ...rule, durationSeconds: e.target.value })}
          placeholder="0"
          min="0"
          max={String(MAX_DURATION_SECONDS)}
          step="1"
          className="w-[120px]"
        />
        <span className="text-sm text-muted-foreground">{t("common.seconds") || "s"}</span>
      </SettingRow>
      {errors.durationSeconds && <Callout tone='error' icon='warning'>{errors.durationSeconds}</Callout>}

      <SettingRow title={t("common.on")}>
        <Switch checked={rule.enabled} onCheckedChange={(val) => setRule({ ...rule, enabled: val })} />
      </SettingRow>

      <div className='flex justify-end gap-2 mt-4'>
        <Button variant='outline' size='sm' onClick={onCancel}>{t("common.cancel")}</Button>
        <Button size='sm' onClick={validateAndSave}>{rule.isNew ? t("common.create") : t("common.save")}</Button>
      </div>
    </div>
  );
}

export function CustomAlertsTab() {
  const { t } = useTranslation();
  const { rules, loading, error, save, remove, toggle, reload } = useCustomRules();
  // Single shared instance so both webhook sections read and write the same state.
  const webhookHook = useWebhookSettings();
  const [editingRule, setEditingRule] = useState<RuleFormState | null>(null);

  const handleNewRule = () => setEditingRule(newRuleForm());
  const handleEditRule = (rule: CustomAlertRule) => setEditingRule(ruleToForm(rule));
  const handleCancelEdit = () => setEditingRule(null);
  const handleSaveRule = async (rule: CustomAlertRule) => {
    await save(rule);
    reload(); // Refresh list after save
  };

  if (loading || webhookHook.loading) return null;

  return (
    <div className='flex flex-col gap-6'>
      <WebhookSettingsSection {...webhookHook} />
      <DailyDigestSettingsSection
        settings={webhookHook.settings}
        setDigest={webhookHook.setDigest}
        loading={webhookHook.loading}
        error={webhookHook.error}
      />

      <SectionLabel>{t("settings.customAlertRules")}</SectionLabel>

      {error && <Callout tone='error' icon='warning'>{t("common.failed", { message: error })}</Callout>}

      {rules.length === 0 && !editingRule && (
        <p className='text-muted-foreground'>{t("settings.noCustomRules")}</p>
      )}

      <div className='flex flex-col gap-2'>
        {rules.map((rule) => (
          <div key={rule.id} className='flex items-center justify-between p-3 border rounded-lg bg-card-muted'>
            <div className='flex flex-col'>
              <span className='font-semibold'>{rule.name}</span>
              <span className='text-sm text-muted-foreground'>
                {METRIC_LABELS[rule.metric]}{" "}
                {rule.condition === "above" ? t("settings.conditionAbove") : t("settings.conditionBelow")}{" "}
                {rule.threshold}{METRIC_BOUNDS[rule.metric].unit}
                {rule.durationSeconds > 0 ? ` for ${rule.durationSeconds}s` : ""}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              <Switch checked={rule.enabled} onCheckedChange={() => toggle(rule)} />
              <Button variant='ghost' size='sm' onClick={() => handleEditRule(rule)}>
                <InfoIcon size={16} />
              </Button>
              <Button variant='ghost' size='sm' onClick={() => remove(rule.id)}>
                <TrashIcon size={16} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {editingRule && (
        <CustomRuleEditor rule={editingRule} onCancel={handleCancelEdit} onSave={handleSaveRule} />
      )}

      {!editingRule && (
        <Button size='sm' onClick={handleNewRule} className='self-start flex items-center gap-2'>
          <PlusIcon size={16} /> {t("settings.addCustomRule")}
        </Button>
      )}
    </div>
  );
}
