import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from './index';

/**
 * Typed version of useDispatch hook
 * Use throughout the app instead of plain `useDispatch`
 */
export const useAppDispatch = () => useDispatch<AppDispatch>();

/**
 * Typed version of useSelector hook
 * Use throughout the app instead of plain `useSelector`
 *
 * Example:
 * const todos = useAppSelector(state => state.todos);
 */
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
