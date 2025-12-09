import React, { createContext, useContext, useState, useCallback } from 'react';

const ModalContext = createContext();

export const useModal = () => useContext(ModalContext);

export const ModalProvider = ({ children }) => {
    const [modalConfig, setModalConfig] = useState(null);

    const hideModal = useCallback(() => setModalConfig(null), []);

    // 1. Simple Alert (Ok button only)
    const showAlert = useCallback((title, message, onOk) => {
        setModalConfig({
            type: 'ALERT',
            title,
            message,
            onConfirm: () => {
                if (onOk) onOk();
                hideModal();
            }
        });
    }, [hideModal]);

    // 2. Confirmation (Confirm / Cancel)
    const showConfirm = useCallback(({ title, message, onConfirm, isDestructive = false }) => {
        setModalConfig({
            type: 'CONFIRM',
            title,
            message,
            isDestructive,
            onConfirm: () => {
                onConfirm();
                hideModal();
            },
            onCancel: hideModal
        });
    }, [hideModal]);

    return (
        <ModalContext.Provider value={{ modalConfig, showAlert, showConfirm, hideModal }}>
            {children}
        </ModalContext.Provider>
    );
};