/**
 * 1.4.0 (QA V139-7): react-native's Modal, marking the UI busy while visible (state/uiBusy.ts) so the
 * review prompt never opens over it. Use it instead of importing Modal from react-native.
 */
import { Modal as RNModal, type ModalProps } from 'react-native';
import { useHoldUi } from '../state/uiBusy';

export function Modal(props: ModalProps) {
  useHoldUi(props.visible !== false);
  return <RNModal {...props} />;
}
