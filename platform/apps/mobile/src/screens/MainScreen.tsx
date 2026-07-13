import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { BottomNavigation, type MainTab } from "../components/BottomNavigation";
import { usePalette } from "../hooks/usePalette";
import { ChatsScreen } from "./ChatsScreen";
import { ContactsScreen } from "./ContactsScreen";
import { ServersScreen } from "./ServersScreen";
import { SettingsScreen } from "./SettingsScreen";

export function MainScreen() {
  const palette = usePalette();
  const [tab, setTab] = useState<MainTab>("chats");
  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <View style={styles.content}>
        {tab === "chats" ? <ChatsScreen embedded /> : null}
        {tab === "servers" ? <ServersScreen /> : null}
        {tab === "profile" ? <ContactsScreen embedded /> : null}
        {tab === "settings" ? <SettingsScreen embedded /> : null}
      </View>
      <BottomNavigation selected={tab} onSelect={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { flex: 1 } });
