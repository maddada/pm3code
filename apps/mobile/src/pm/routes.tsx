import { createNativeStackScreen } from "@react-navigation/native-stack";

import { sheetRoute } from "../features/layout/route-options";
import { PmNewSheet } from "./newSheet";
import { PmPageSheet } from "./pageSheet";
import { PmSheet } from "./sheet";

/** The PM sheets for the root stack: details at half height, a Live page and New PM taller. */
export const pmScreens = {
  PmSheet: createNativeStackScreen({
    screen: PmSheet,
    options: sheetRoute({ detent: 0.5, androidMaxDetent: 0.95 }),
  }),
  PmPage: createNativeStackScreen({
    screen: PmPageSheet,
    options: sheetRoute({ detent: 0.9, android: "fullScreen" }),
  }),
  PmNew: createNativeStackScreen({
    screen: PmNewSheet,
    options: sheetRoute({ detent: 0.6, androidMaxDetent: 0.9 }),
  }),
};
