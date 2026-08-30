import * as LocalAuthentication from "expo-local-authentication";

import { SettingsSwitchRow } from "../components/settings/SettingsGroup";
import { useAppDialog } from "../components/AppDialogProvider";
import { useTranslation } from "../i18n";
import { productCopy } from "../lib/productCopy";
import { userFacingError } from "../lib/userFacingError";
import { setAppLockEnabled, useAppLockEnabled } from "./localAppLock";

export function AppLockSettingRow() {
  const { language, t } = useTranslation();
  const showDialog = useAppDialog();
  const enabled = useAppLockEnabled();
  const pc = (key: Parameters<typeof productCopy>[1]) => productCopy(language, key);

  const change = async (next: boolean) => {
    try {
      if (next) {
        const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
        if (!hardware || !enrolled) { showDialog(pc("appLock"), pc("appLockUnavailable")); return; }
        const result = await LocalAuthentication.authenticateAsync({ promptMessage: pc("appLock"), promptDescription: pc("appLockDescription"), cancelLabel: t("cancel"), biometricsSecurityLevel: "strong", disableDeviceFallback: false });
        if (!result.success) return;
      }
      await setAppLockEnabled(next);
    } catch (error) { showDialog(t("saveFailed"), userFacingError(error, t)); }
  };

  return <SettingsSwitchRow icon="lock-closed-outline" label={pc("appLock")} value={enabled} onChange={(next) => void change(next)} />;
}
