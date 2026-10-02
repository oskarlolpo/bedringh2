package com.modrinth.theseus.agent.transformers;

import java.nio.charset.StandardCharsets;
import java.util.ListIterator;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

/**
 * Forces {@code IntegratedServer.initServer()} to call {@code this.setOnlineMode(false)} instead of
 * {@code this.setOnlineMode(true)} across all Minecraft versions (Vanilla obfuscated, Fabric
 * Intermediary, Forge/NeoForge) so that Singleplayer worlds opened via "Open to LAN" accept all
 * players (offline pirated accounts, Bedringh ID, KLauncher, TLauncher, other launchers, and VPN
 * connections) without throwing "Failed to log in: Invalid session".
 */
public final class IntegratedServerTransformer extends ClassNodeTransformer {
    private static final String MARKER = "Starting integrated minecraft server version";
    private static final byte[] MARKER_BYTES = MARKER.getBytes(StandardCharsets.UTF_8);

    public static boolean mightBeIntegratedServer(String className, byte[] classData) {
        if (className == null || classData == null || classData.length < MARKER_BYTES.length) {
            return false;
        }
        if (className.startsWith("java/")
                || className.startsWith("javax/")
                || className.startsWith("sun/")
                || className.startsWith("jdk/")
                || className.startsWith("org/")
                || className.startsWith("com/")
                || className.startsWith("io/")
                || className.startsWith("it/")
                || className.startsWith("oshi/")) {
            return false;
        }
        return containsBytes(classData, MARKER_BYTES);
    }

    private static boolean containsBytes(byte[] haystack, byte[] needle) {
        final byte first = needle[0];
        final int max = haystack.length - needle.length;
        for (int i = 0; i <= max; i++) {
            if (haystack[i] != first) {
                continue;
            }
            boolean match = true;
            for (int j = 1; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                return true;
            }
        }
        return false;
    }

    @Override
    protected boolean transform(ClassNode classNode) {
        boolean modified = false;
        for (final MethodNode method : classNode.methods) {
            boolean seenMarker = false;
            final ListIterator<AbstractInsnNode> it = method.instructions.iterator();
            while (it.hasNext()) {
                final AbstractInsnNode insn = it.next();
                if (!seenMarker) {
                    if (insn instanceof LdcInsnNode) {
                        final Object cst = ((LdcInsnNode) insn).cst;
                        if (cst instanceof String && ((String) cst).startsWith(MARKER)) {
                            seenMarker = true;
                        }
                    }
                } else if (insn.getOpcode() == Opcodes.ICONST_1) {
                    AbstractInsnNode next = insn.getNext();
                    while (next != null && next.getOpcode() == -1) {
                        next = next.getNext();
                    }
                    if (next instanceof MethodInsnNode) {
                        final MethodInsnNode mInsn = (MethodInsnNode) next;
                        if (mInsn.getOpcode() == Opcodes.INVOKEVIRTUAL && "(Z)V".equals(mInsn.desc)) {
                            it.set(new InsnNode(Opcodes.ICONST_0));
                            modified = true;
                            break;
                        }
                    }
                }
            }
        }
        return modified;
    }
}
