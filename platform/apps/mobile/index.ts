import "react-native-gesture-handler";
import "react-native-reanimated";
import "./src/notifications/backgroundNotificationTask";

import { registerRootComponent } from "expo";
import { registerGlobals } from "@livekit/react-native";

import App from "./App";

registerGlobals();
registerRootComponent(App);
