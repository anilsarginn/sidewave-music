import {createContext,useContext} from 'react';
import type {Parca} from './api';
export type DiscoveryTarget={parca?:Parca;artistId?:string;mode:'instant-mix'|'similar-tracks'|'path'|'artists'};
export const DiscoveryContext=createContext<{open:(target:DiscoveryTarget)=>void}|null>(null);
export const useDiscovery=()=>useContext(DiscoveryContext);
