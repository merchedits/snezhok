import { AppIcon } from "./AppIcon";
import { memo, useEffect, useMemo, useRef } from "react";
import { type GestureResponderEvent, Pressable, Text, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";

import type { Message } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { useUiPreferences } from "../hooks/useUiPreferences";
import { useTranslation } from "../i18n";
import { renderableAttachments, renderableReactions } from "../domains/messaging/messagePayload";
import { Avatar } from "./Avatar";
import { CooperativeActivityCard } from "./CooperativeActivityCard";
import { MediaAlbum, SafeAttachmentView } from "./message/MessageMedia";
import { messageBubbleStyles as styles } from "./message/messageBubbleStyles";

interface MessageBubbleProps {
  streamId: string;
  message: Message;
  mine: boolean;
  showSender: boolean;
  variant: "bubble" | "channel";
  selected?: boolean;
  selectionMode?: boolean;
  selectionProgress: SharedValue<number>;
  onPress?: () => void;
  onLongPress?: () => void;
  onReact?: (emoji: string) => void;
  onOpenReactions?: (anchorY: number) => void;
  onReplyPress?: (messageId: string) => void;
  onOpenActivity?: () => void;
}

export const MessageBubble = memo(
  function MessageBubble({ streamId, message, mine, showSender, variant, selected = false, selectionMode = false, selectionProgress, onPress, onLongPress, onReact, onOpenReactions, onReplyPress, onOpenActivity }: MessageBubbleProps) {
    const palette = usePalette();
    const ui = useUiPreferences();
    const displayAttachments = useMemo(() => renderableAttachments(message.attachments), [message.attachments]);
    const mediaOnly = !message.activity && !message.text && !message.replyTo && !message.forwardedFrom && displayAttachments.length > 0 && displayAttachments.every((attachment) => attachment.kind === "image" || attachment.kind === "video") && variant === "bubble";
    const lastTapAt = useRef(0);
    const tapAnchorY = useRef(0);
    const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTriggered = useRef(false);
    useEffect(
      () => () => {
        if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      },
      [],
    );
    useEffect(() => {
      // FlashList recycles the native row for another message. Gesture state must
      // never leak from the previously displayed item into the recycled cell.
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
      lastTapAt.current = 0;
      longPressTriggered.current = false;
    }, [message.id]);
    useEffect(() => {
      if (!selectionMode || !singleTapTimer.current) return;
      clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
      lastTapAt.current = 0;
    }, [selectionMode]);
    const selectionContentStyle = useAnimatedStyle(() => ({
      // Incoming/direct and server messages need to clear the selector. Outgoing
      // bubbles already live on the opposite edge, so keeping them stationary
      // avoids clipping and leaves this as a compositor-only animation.
      transform: [
        {
          translateX: mine && variant === "bubble" ? 0 : 34 * selectionProgress.value,
        },
      ],
    }));
    const selectionMarkerStyle = useAnimatedStyle(() => ({
      opacity: selectionProgress.value,
      transform: [{ scale: 0.76 + 0.24 * selectionProgress.value }],
    }));
    const handlePress = (event: GestureResponderEvent) => {
      if (longPressTriggered.current) {
        longPressTriggered.current = false;
        return;
      }
      tapAnchorY.current = event.nativeEvent.pageY;
      if (selectionMode) {
        lastTapAt.current = 0;
        onPress?.();
        return;
      }
      const now = Date.now();
      if (now - lastTapAt.current <= 280) {
        if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
        lastTapAt.current = 0;
        onReact?.("\u2764\uFE0F");
        return;
      }
      lastTapAt.current = now;
      singleTapTimer.current = setTimeout(() => {
        singleTapTimer.current = null;
        lastTapAt.current = 0;
        onOpenReactions?.(tapAnchorY.current);
      }, 280);
    };
    const handleLongPress = () => {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
      longPressTriggered.current = true;
      lastTapAt.current = 0;
      onLongPress?.();
    };
    if (message.deletedAt) return null;
    if (variant === "channel") {
      return (
        <View style={styles.selectionFrame}>
          <SelectionMarker selected={selected} animatedStyle={selectionMarkerStyle} />
          <Animated.View style={[styles.selectionContent, selectionContentStyle]}>
            <Pressable
              delayLongPress={240}
              onPress={handlePress}
              onLongPress={handleLongPress}
              style={({ pressed }) => [
                styles.channelRow,
                {
                  paddingVertical: ui.dense(3, 1),
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <View style={styles.channelAvatar}>{showSender ? <Avatar uri={message.sender.avatarUrl} label={message.sender.displayName} color={message.sender.avatarColor} size={40} /> : null}</View>
              <View style={[styles.channelContent, selected && { backgroundColor: palette.accentSoft }]}>
                {showSender ? (
                  <View style={styles.authorLine}>
                    <Text
                      style={[
                        styles.channelAuthor,
                        {
                          color: message.sender.avatarColor || palette.text,
                          fontSize: ui.font(15),
                        },
                      ]}
                    >
                      {message.sender.displayName}
                    </Text>
                    <Text style={[styles.channelTime, { color: palette.faintText, fontSize: ui.font(11) }]}>
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                ) : null}
                <MessageContent streamId={streamId} message={message} mine={mine} foreground={palette.text} mutedForeground={palette.secondaryText} showSender={false} showTime={false} mediaOnly={false} interactionDisabled={selectionMode} onReact={onReact} onReplyPress={onReplyPress} onOpenActivity={onOpenActivity} />
              </View>
            </Pressable>
          </Animated.View>
        </View>
      );
    }
    return (
      <View style={styles.selectionFrame}>
        <SelectionMarker selected={selected} animatedStyle={selectionMarkerStyle} />
        <Animated.View style={[styles.selectionContent, selectionContentStyle]}>
          <View style={[styles.row, mine ? styles.mineRow : styles.theirRow, { marginVertical: ui.dense(2, 1) }]}>
            <Pressable
              delayLongPress={240}
              onPress={message.activity ? undefined : handlePress}
              onLongPress={handleLongPress}
              style={({ pressed }) => [
                styles.bubble,
                message.activity && styles.activityBubble,
                mediaOnly && styles.mediaBubble,
                mine ? styles.mineBubble : styles.theirBubble,
                {
                  borderRadius: message.activity ? 24 : mediaOnly ? 16 : ui.bubbleRadius,
                  paddingHorizontal: message.activity || mediaOnly ? 0 : ui.dense(12, 10),
                  paddingVertical: message.activity || mediaOnly ? 0 : ui.dense(8, 5),
                  backgroundColor: message.activity || mediaOnly ? "transparent" : selected ? palette.accentSoft : mine ? palette.outgoing : palette.incoming,
                  borderWidth: selected && !message.activity ? (mediaOnly ? 2 : 1.5) : 0,
                  borderColor: selected ? palette.accent : "transparent",
                  opacity: pressed ? 0.82 : 1,
                },
              ]}
            >
              <MessageContent streamId={streamId} message={message} mine={mine} foreground={selected || !mine ? palette.text : palette.onAccent} mutedForeground={selected || !mine ? palette.secondaryText : "rgba(255,255,255,0.76)"} showSender={showSender && !mine} showTime mediaOnly={mediaOnly} interactionDisabled={selectionMode} onReact={onReact} onReplyPress={onReplyPress} onOpenActivity={onOpenActivity} />
            </Pressable>
          </View>
        </Animated.View>
      </View>
    );
  },
  (previous, next) => previous.message === next.message && previous.streamId === next.streamId && previous.mine === next.mine && previous.showSender === next.showSender && previous.variant === next.variant && previous.selected === next.selected && previous.selectionMode === next.selectionMode && previous.selectionProgress === next.selectionProgress,
);

function SelectionMarker({ selected, animatedStyle }: { selected: boolean; animatedStyle: ReturnType<typeof useAnimatedStyle> }) {
  const palette = usePalette();
  return (
    <Animated.View pointerEvents="none" style={[styles.selectionMarker, animatedStyle]}>
      <View
        style={[
          styles.selectionCircle,
          {
            borderColor: selected ? palette.accent : palette.faintText,
            backgroundColor: selected ? palette.accent : "transparent",
          },
        ]}
      >
        {selected ? <AppIcon name="checkmark" size={15} color={palette.onAccent} strokeWidth={2} /> : null}
      </View>
    </Animated.View>
  );
}

function MessageContent({ streamId, message, mine, foreground, mutedForeground, showSender, showTime, mediaOnly, interactionDisabled, onReact, onReplyPress, onOpenActivity }: { streamId: string; message: Message; mine: boolean; foreground: string; mutedForeground: string; showSender: boolean; showTime: boolean; mediaOnly: boolean; interactionDisabled: boolean; onReact?: ((emoji: string) => void) | undefined; onReplyPress?: ((messageId: string) => void) | undefined; onOpenActivity?: (() => void) | undefined }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const attachments = useMemo(() => renderableAttachments(message.attachments), [message.attachments]);
  const mediaAttachments = attachments.filter((attachment) => attachment.kind === "image" || attachment.kind === "video");
  const otherAttachments = mediaAttachments.length > 1 ? attachments.filter((attachment) => attachment.kind !== "image" && attachment.kind !== "video") : attachments;
  const reactions = useMemo(() => renderableReactions(message.reactions), [message.reactions]);
  const showMeta = showTime || Boolean(message.editedAt) || Boolean(message.pinnedAt) || (mine && Boolean(message.pending || message.failed));
  const metadata = showMeta ? <MessageMetadata message={message} mine={mine} showTime={showTime} foreground={mediaOnly ? "white" : foreground} mutedForeground={mediaOnly ? "rgba(255,255,255,0.94)" : mutedForeground} overlay={mediaOnly} /> : null;
  const reactionBar = reactions.length > 0 ? <ReactionBar reactions={reactions} overlay={mediaOnly} onReact={onReact} /> : null;
  const inlineMetadata = Boolean(message.text && !attachments.length && !message.replyTo && !message.forwardedFrom && !reactionBar && metadata);
  if (message.activity) return <CooperativeActivityCard activity={message.activity} onOpen={() => onOpenActivity?.()} />;
  return (
    <View pointerEvents={interactionDisabled ? "none" : "auto"}>
      {showSender && !mediaOnly ? (
        <Text
          style={[
            styles.sender,
            {
              color: message.sender.avatarColor || palette.accent,
              fontSize: ui.font(13),
            },
          ]}
        >
          {message.sender.displayName}
        </Text>
      ) : null}
      {message.replyTo ? (
        <Pressable accessibilityRole="button" onPress={() => onReplyPress?.(message.replyTo!.id)} style={[styles.reply, { borderColor: palette.accent }]}>
          <Text numberOfLines={1} style={[styles.replyName, { color: palette.accent, fontSize: ui.font(12) }]}>
            {message.replyTo.senderName}
          </Text>
          <Text numberOfLines={1} style={[styles.replyText, { color: mutedForeground, fontSize: ui.font(12) }]}>
            {message.replyTo.text}
          </Text>
        </Pressable>
      ) : null}
      {message.forwardedFrom ? (
        <View style={styles.forwarded}>
          <AppIcon name="return-up-forward" size={13} color={palette.accent} />
          <Text numberOfLines={1} style={[styles.forwardedText, { color: palette.accent }]}>
            {message.forwardedFrom.senderName}
          </Text>
        </View>
      ) : null}
      {mediaOnly ? (
        <View style={styles.mediaStage}>
          {mediaAttachments.length > 1 ? <MediaAlbum attachments={mediaAttachments} /> : null}
          {otherAttachments.map((attachment) => (
            <SafeAttachmentView key={attachment.id} attachment={attachment} streamId={streamId} mine={mine} foreground={foreground} mutedForeground={mutedForeground} />
          ))}
          {showSender ? (
            <View style={[styles.mediaSenderOverlay, styles.overlayIsland]}>
              <Text numberOfLines={1} style={styles.mediaSender}>
                {message.sender.displayName}
              </Text>
            </View>
          ) : null}
          {reactionBar ? <View style={styles.mediaReactionOverlay}>{reactionBar}</View> : null}
          {metadata ? <View style={styles.mediaMetaOverlay}>{metadata}</View> : null}
        </View>
      ) : (
        <>
          {mediaAttachments.length > 1 ? <MediaAlbum attachments={mediaAttachments} /> : null}
          {otherAttachments.map((attachment) => (
            <SafeAttachmentView key={attachment.id} attachment={attachment} streamId={streamId} mine={mine} foreground={foreground} mutedForeground={mutedForeground} />
          ))}
        </>
      )}
      {message.text ? (
        <View style={inlineMetadata ? styles.inlineTextWrap : undefined}>
          <Text
            selectable={false}
            style={[
              styles.text,
              {
                color: foreground,
                fontSize: ui.font(16),
                lineHeight: ui.font(21),
              },
            ]}
          >
            {message.text}
            {inlineMetadata ? <Text style={styles.inlineMetaSpacer}>        </Text> : null}
          </Text>
          {inlineMetadata ? <View style={styles.inlineMeta}>{metadata}</View> : null}
        </View>
      ) : null}
      {!mediaOnly && !inlineMetadata && (reactionBar || metadata) ? (
        <View style={[styles.footer, !showTime && styles.channelFooter]}>
          {reactionBar}
          <View style={styles.footerSpacer} />
          {metadata}
        </View>
      ) : null}
    </View>
  );
}

function MessageMetadata({ message, mine, showTime, foreground, mutedForeground, overlay }: { message: Message; mine: boolean; showTime: boolean; foreground: string; mutedForeground: string; overlay: boolean }) {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <View style={[styles.meta, overlay && styles.overlayIsland]}>
      {message.pinnedAt ? (
        <View style={styles.pinned}>
          <AppIcon name="pin" size={10} color={overlay ? "white" : palette.accent} />
          <Text style={[styles.edited, { color: overlay ? "white" : palette.accent }]}>{t("pinnedMessage")}</Text>
        </View>
      ) : null}
      {message.editedAt ? <Text style={[styles.edited, { color: mutedForeground }]}>edited</Text> : null}
      {showTime ? (
        <Text style={[styles.time, { color: mutedForeground }]}>
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      ) : null}
      {mine ? <AppIcon name={message.failed ? "alert-circle" : message.pending ? "time-outline" : message.readByOthers ? "checkmark-done" : "checkmark"} size={14} color={message.failed ? palette.danger : foreground} /> : null}
    </View>
  );
}

function ReactionBar({ reactions, overlay, onReact }: { reactions: ReturnType<typeof renderableReactions>; overlay: boolean; onReact?: ((emoji: string) => void) | undefined }) {
  const palette = usePalette();
  return (
    <View style={styles.reactions}>
      {reactions.map((reaction) => (
        <Pressable
          accessibilityLabel={reaction.emoji}
          key={reaction.emoji}
          onPress={() => onReact?.(reaction.emoji)}
          style={[
            styles.reaction,
            overlay
              ? styles.overlayReaction
              : {
                  backgroundColor: reaction.reacted ? palette.accentSoft : palette.moment.pink,
                  borderColor: reaction.reacted ? palette.accent : palette.outline,
                },
          ]}
        >
          <Text style={styles.emoji}>{reaction.emoji}</Text>
        </Pressable>
      ))}
    </View>
  );
}
