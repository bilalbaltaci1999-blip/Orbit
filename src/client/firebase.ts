import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { UserProfile, UserSettings } from '../shared/types.ts';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const isConfigured =
  Boolean(firebaseConfig?.apiKey) &&
  Boolean(firebaseConfig?.projectId) &&
  firebaseConfig.projectId !== 'remixed-project-id';

const app = isConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
/* CRITICAL: Pass firestoreDatabaseId to getFirestore */
export const db = app ? getFirestore(app, firebaseConfig.firestoreDatabaseId) : null;

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export async function signInWithFirebaseGoogle(): Promise<{
  firebaseUser: FirebaseUser;
  idToken: string;
}> {
  if (!auth) {
    throw new Error('Firebase kimlik doğrulama yapılandırılmamış.');
  }
  const result = await signInWithPopup(auth, googleProvider);
  const idToken = await result.user.getIdToken();
  return { firebaseUser: result.user, idToken };
}

export async function signOutFirebase(): Promise<void> {
  if (!auth || !auth.currentUser) return;
  await signOut(auth);
}

export async function syncUserToFirestore(
  profile: UserProfile,
  settings?: UserSettings | null
): Promise<void> {
  if (!db || !auth?.currentUser || !auth.currentUser.emailVerified) return;
  const uid = auth.currentUser.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  const safeEmail = (auth.currentUser.email || profile.email || 'user@orbit.app').trim().slice(0, 180);
  const safeDisplayName = (profile.displayName || 'ORBIT Üyesi').trim().slice(0, 40) || 'ORBIT Üyesi';
  const rawUsername = (profile.username || 'orbit_user').trim();
  const safeUsername = (rawUsername.length >= 3 ? rawUsername : `usr_${rawUsername}`).slice(0, 30);
  const safePhotoUrl =
    profile.avatarUrl && /^https?:\/\//i.test(profile.avatarUrl)
      ? profile.avatarUrl.slice(0, 500)
      : auth.currentUser.photoURL && /^https?:\/\//i.test(auth.currentUser.photoURL)
      ? auth.currentUser.photoURL.slice(0, 500)
      : undefined;
  const safeCustomStatus = profile.customStatus ? profile.customStatus.trim().slice(0, 80) : undefined;
  const safeStatus = (['online', 'idle', 'dnd', 'offline'] as const).includes(profile.preferredStatus)
    ? profile.preferredStatus
    : 'online';
  const safeNitroTier = profile.nitroTier === 'nitro' ? 'nitro' : 'none';

  try {
    const existingSnap = await getDoc(userRef);
    const payload: Record<string, unknown> = {
      uid,
      email: safeEmail,
      displayName: safeDisplayName,
      username: safeUsername,
      preferredStatus: safeStatus,
      nitroTier: safeNitroTier,
      authProvider: 'google',
      updatedAt: serverTimestamp(),
    };
    if (safePhotoUrl) payload.photoUrl = safePhotoUrl;
    if (safeCustomStatus) payload.customStatus = safeCustomStatus;

    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        email: safeEmail,
        displayName: safeDisplayName,
        username: safeUsername,
        ...(safePhotoUrl ? { photoUrl: safePhotoUrl } : {}),
        preferredStatus: safeStatus,
        ...(safeCustomStatus ? { customStatus: safeCustomStatus } : {}),
        nitroTier: safeNitroTier,
        authProvider: 'google',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  if (settings) {
    const prefPath = `users/${uid}/preferences/default`;
    const prefRef = doc(db, 'users', uid, 'preferences', 'default');
    try {
      const prefSnap = await getDoc(prefRef);
      const prefData = {
        theme: settings.theme,
        fontSize: settings.fontSize,
        messageDensity: settings.messageDensity,
        inAppNotifications: Boolean(settings.inAppNotifications),
        soundEnabled: Boolean(settings.soundEnabled),
        showOnlineStatus: Boolean(settings.showOnlineStatus),
        dmPermission: settings.dmPermission,
        updatedAt: serverTimestamp(),
      };
      if (!prefSnap.exists()) {
        await setDoc(prefRef, { uid, ...prefData });
      } else {
        await updateDoc(prefRef, prefData);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, prefPath);
    }
  }
}

export async function syncReadCursorToFirestore(
  targetType: 'channel' | 'dm',
  targetId: string,
  lastReadMessageId: string,
  lastReadAt: string
): Promise<void> {
  if (!db || !auth?.currentUser || !auth.currentUser.emailVerified) return;
  const uid = auth.currentUser.uid;
  const sanitizedTarget = targetId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 100);
  const cursorId = `${targetType}_${sanitizedTarget}`.slice(0, 128);
  const cursorPath = `users/${uid}/readCursors/${cursorId}`;
  const cursorRef = doc(db, 'users', uid, 'readCursors', cursorId);

  try {
    const snap = await getDoc(cursorRef);
    const safeMsgId = lastReadMessageId.slice(0, 128);
    const safeReadAt = lastReadAt.slice(0, 64);
    if (!snap.exists()) {
      await setDoc(cursorRef, {
        uid,
        targetType,
        targetId: targetId.slice(0, 128),
        lastReadMessageId: safeMsgId,
        lastReadAt: safeReadAt,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(cursorRef, {
        lastReadMessageId: safeMsgId,
        lastReadAt: safeReadAt,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, cursorPath);
  }
}
