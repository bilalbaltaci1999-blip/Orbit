import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth, syncUserToFirestore } from './firebase.ts';
import { useAuth } from './AuthContext.tsx';

interface FirebaseContextValue {
  firebaseUser: FirebaseUser | null;
  authReady: boolean;
}

const FirebaseContext = createContext<FirebaseContextValue>({
  firebaseUser: null,
  authReady: false,
});

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const { profile, settings } = useAuth();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(!auth);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser || !firebaseUser.emailVerified || !profile) return;
    void syncUserToFirestore(profile, settings).catch(() => {
      // Handled by handleFirestoreError logging
    });
  }, [authReady, firebaseUser, profile, settings]);

  return (
    <FirebaseContext.Provider value={{ firebaseUser, authReady }}>
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase(): FirebaseContextValue {
  return useContext(FirebaseContext);
}
