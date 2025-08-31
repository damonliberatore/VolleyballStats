import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';

// --- Helper Components ---

const SetterIcon = () => (
 <span className="absolute top-1 right-1 bg-red-500 text-white text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center z-10">S</span>
);

const PlayerCard = ({ player, isSetter, onClick, isTarget }) => (
 <div
 onClick={onClick}
 className={`relative bg-gray-700 text-white p-4 rounded-lg shadow-md text-center cursor-pointer hover:bg-gray-600 transition-colors duration-200 h-24 flex flex-col justify-center ${isTarget ? 'ring-2 ring-cyan-400' : ''}`}
 >
 {player ? (
 <>
 <span className="text-xl font-bold">#{player.number}</span>
 <span className="text-sm truncate">{player.name}</span>
 {isSetter && <SetterIcon />}
 </>
 ) : (
 <span className="text-gray-400">Empty</span>
 )}
 </div>
);

const Modal = ({ title, children, isOpen, onClose }) => {
 if (!isOpen) return null;
 return (
 <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
 <div className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-md md:max-w-lg mx-4">
 <div className="flex justify-between items-center mb-4">
 <h2 className="text-2xl font-bold text-cyan-400">{title}</h2>
 <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
 </div>
 <div>{children}</div>
 </div>
 </div>
 );
};

// --- Main App Component ---
export default function App() {
 // --- State Management ---
 const [gameState, setGameState] = useState({
 homeScore: 0,
 opponentScore: 0,
 homeSetsWon: 0,
 opponentSetsWon: 0,
 servingTeam: null,
 homeSubs: 0,
 currentSet: 1,
 rotation: 1,
 });
 const [matchPhase, setMatchPhase] = useState('pre_match'); // pre_match, lineup_setup, playing, post_match
 const [matchId, setMatchId] = useState(null);
 const [matchName, setMatchName] = useState('');

 const [roster, setRoster] = useState([]);
 const [lineup, setLineup] = useState({ p1: null, p2: null, p3: null, p4: null, p5: null, p6: null });
 const [libero, setLibero] = useState(null);
 const [setterId, setSetterId] = useState(null);
 const [bench, setBench] = useState([]);
 const [pointLog, setPointLog] = useState([]);
 const [playerStats, setPlayerStats] = useState({}); // Cumulative stats for the whole match
 const [setStats, setSetStats] = useState({}); // Stats for the current set only
 const [seasonStats, setSeasonStats] = useState({}); // All stats from all matches
 const [rotationScores, setRotationScores] = useState({});
 const [subGroups, setSubGroups] = useState({});
 const [history, setHistory] = useState([]);

 // UI State
 const [modal, setModal] = useState(null);
 const [subTarget, setSubTarget] = useState({ position: null, playerOutId: null });
 const [statToAssign, setStatToAssign] = useState(null);
 const [kwdaAttackerId, setKwdaAttackerId] = useState(null);
 const [activeTab, setActiveTab] = useState('set_stats'); // set_stats, match_stats, season_stats, log, rotations
 const [setupStep, setSetupStep] = useState('players'); // players, libero, setter
 const [savedMatches, setSavedMatches] = useState([]);

 // Firebase state
 const [db, setDb] = useState(null);
 const [auth, setAuth] = useState(null);
 const [userId, setUserId] = useState(null);
 const [isAuthReady, setIsAuthReady] = useState(false);

 // --- Firebase Initialization & Auth ---
 useEffect(() => {
 const firebaseConfig = {
  apiKey: "AIzaSyBjwF3op5ssqIxCye_RVTgnXMmn2bVIjs4",
  authDomain: "my-volleyball-stats.firebaseapp.com",
  projectId: "my-volleyball-stats",
  storageBucket: "my-volleyball-stats.firebasestorage.app",
  messagingSenderId: "186322710860",
  appId: "1:186322710860:web:78394224ca3af398bb5fe9",
  measurementId: "G-4X3P912GF9"
};
 
 // --- Data Persistence & Season Stats ---
 const getMatchCollectionRef = useCallback(() => {
 if (!db || !userId) return null;
 const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
 return collection(db, 'artifacts', appId, 'users', userId, 'matches');
 }, [db, userId]);

 const calculateSeasonStats = async () => {
 if (!getMatchCollectionRef()) return;
 try {
 const querySnapshot = await getDocs(getMatchCollectionRef());
 const allMatches = querySnapshot.docs.map(doc => doc.data());
 
 const compiledStats = {};
 const allPlayers = [];

 allMatches.forEach(match => {
 match.roster.forEach(player => {
 if (!allPlayers.some(p => p.number === player.number)) {
 allPlayers.push(player);
 }
 });

 for (const playerId in match.playerStats) {
 if (!compiledStats[playerId]) {
 const playerInfo = match.roster.find(p => p.id === playerId);
 compiledStats[playerId] = { ...playerInfo, stats: {} };
 }
 for (const stat in match.playerStats[playerId]) {
 compiledStats[playerId].stats[stat] = (compiledStats[playerId].stats[stat] || 0) + match.playerStats[playerId][stat];
 }
 }
 });
 setSeasonStats({ players: allPlayers, stats: compiledStats });

 } catch (error) {
 console.error("Error calculating season stats:", error);
 }
 };

 const saveMatchToFirebase = async () => {
 if (!getMatchCollectionRef() || !matchId) {
 console.error("Firestore not ready or no match ID to save.");
 return;
 }
 
 const serializableSubGroups = {};
 for (const key in subGroups) {
 serializableSubGroups[key] = Array.from(subGroups[key]);
 }

 const matchData = {
 matchId,
 matchName: matchName || `Match started on ${new Date().toLocaleDateString()}`,
 lastSaved: new Date().toISOString(),
 gameState,
 matchPhase,
 roster,
 lineup,
 libero,
 setterId,
 bench,
 pointLog,
 playerStats,
 setStats,
 rotationScores,
 subGroups: serializableSubGroups,
 };
 
 try {
 await setDoc(doc(getMatchCollectionRef(), matchId), matchData);
 alert("Match saved successfully!");
 } catch (error) {
 console.error("Error saving match:", error);
 alert("Error: Could not save match.");
 }
 };

 const loadMatchesFromFirebase = async () => {
 if (!getMatchCollectionRef()) return;
 try {
 const querySnapshot = await getDocs(getMatchCollectionRef());
 const matches = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
 setSavedMatches(matches);
 setModal('load-match');
 } catch (error) {
 console.error("Error loading matches:", error);
 }
 };

 const loadSpecificMatch = (matchData) => {
 const restoredSubGroups = {};
 if (matchData.subGroups) {
 for (const key in matchData.subGroups) {
 restoredSubGroups[key] = new Set(matchData.subGroups[key]);
 }
 }
 
 setMatchId(matchData.matchId);
 setMatchName(matchData.matchName);
 setGameState(matchData.gameState);
 setMatchPhase(matchData.matchPhase);
 setRoster(matchData.roster);
 setLineup(matchData.lineup);
 setLibero(matchData.libero);
 setSetterId(matchData.setterId);
 setBench(matchData.bench);
 setPointLog(matchData.pointLog);
 setPlayerStats(matchData.playerStats);
 setSetStats(matchData.setStats || {});
 setRotationScores(matchData.rotationScores);
 setSubGroups(restoredSubGroups);
 setHistory([]);
 setModal(null);
 };

 // --- Undo and History Logic ---
 const saveToHistory = () => {
 const serializableSubGroups = {};
 for (const key in subGroups) { serializableSubGroups[key] = Array.from(subGroups[key]); }
 const snapshot = {
 gameState: JSON.parse(JSON.stringify(gameState)),
 lineup: JSON.parse(JSON.stringify(lineup)),
 playerStats: JSON.parse(JSON.stringify(playerStats)),
 setStats: JSON.parse(JSON.stringify(setStats)),
 pointLog: JSON.parse(JSON.stringify(pointLog)),
 bench: JSON.parse(JSON.stringify(bench)),
 subGroups: serializableSubGroups,
 rotationScores: JSON.parse(JSON.stringify(rotationScores)),
 };
 setHistory(prev => [...prev, snapshot]);
 };

 const handleUndo = () => {
 if (history.length === 0) return;
 const lastState = history[history.length - 1];
 const restoredSubGroups = {};
 for (const key in lastState.subGroups) { restoredSubGroups[key] = new Set(lastState.subGroups[key]); }
 setGameState(lastState.gameState);
 setLineup(lastState.lineup);
 setPlayerStats(lastState.playerStats);
 setSetStats(lastState.setStats);
 setPointLog(lastState.pointLog);
 setBench(lastState.bench);
 setSubGroups(restoredSubGroups);
 setRotationScores(lastState.rotationScores);
 setHistory(prev => prev.slice(0, -1));
 };

 // --- Game Logic Functions ---
 const handleStartNewMatch = () => setModal('roster');

 const handleSaveRoster = (newRoster, name) => {
 const newMatchId = crypto.randomUUID();
 setMatchId(newMatchId);
 setMatchName(name);

 const rosterWithIds = newRoster.map(p => ({ ...p, id: crypto.randomUUID() }));
 setRoster(rosterWithIds);
 
 const initialStats = {};
 rosterWithIds.forEach(p => { initialStats[p.id] = {}; });
 setPlayerStats(initialStats);
 setSetStats(initialStats);

 setGameState({ homeScore: 0, opponentScore: 0, homeSetsWon: 0, opponentSetsWon: 0, servingTeam: null, homeSubs: 0, currentSet: 1, rotation: 1 });
 setMatchPhase('lineup_setup');
 setModal(null);
 };

 const handleEndSet = () => {
 const winner = gameState.homeScore > gameState.opponentScore ? 'home' : 'opponent';
 const newHomeSetsWon = gameState.homeSetsWon + (winner === 'home' ? 1 : 0);
 const newOpponentSetsWon = gameState.opponentSetsWon + (winner === 'opponent' ? 1 : 0);

 if (newHomeSetsWon >= 3 || newOpponentSetsWon >= 3) {
 setMatchPhase('post_match');
 setGameState(prev => ({ ...prev, homeSetsWon: newHomeSetsWon, opponentSetsWon: newOpponentSetsWon }));
 calculateSeasonStats(); // Update season stats at the end of the match
 return;
 }

 setGameState(prev => ({
 ...prev,
 homeScore: 0, opponentScore: 0,
 homeSetsWon: newHomeSetsWon, opponentSetsWon: newOpponentSetsWon,
 currentSet: prev.currentSet + 1,
 homeSubs: 0, servingTeam: null, rotation: 1,
 }));
 
 setLineup({ p1: null, p2: null, p3: null, p4: null, p5: null, p6: null });
 setLibero(null);
 setSetterId(null);
 setBench([]);
 setPointLog([]);
 setHistory([]);
 setSetupStep('players');
 setMatchPhase('lineup_setup');
 setModal(null);
 };

 const handleStartSet = (servingTeam) => {
 const lineupIds = Object.values(lineup).filter(Boolean);
 const onCourtIds = [...lineupIds, ...(libero ? [libero] : [])];
 setBench(roster.filter(p => !onCourtIds.includes(p.id)));

 const initialSubGroups = {};
 lineupIds.forEach(playerId => { initialSubGroups[playerId] = new Set([playerId]); });
 setSubGroups(initialSubGroups);
 
 const initialSetStats = {};
 roster.forEach(p => { initialSetStats[p.id] = {}; });
 setSetStats(initialSetStats);
 
 const initialRotationScores = {};
 for (let i = 1; i <= 6; i++) { initialRotationScores[i] = { home: 0, opponent: 0 }; }
 setRotationScores(initialRotationScores);

 setGameState(prev => ({ ...prev, servingTeam, homeScore: 0, opponentScore: 0, homeSubs: 0 }));
 setPointLog([]);
 setHistory([]);
 setMatchPhase('playing');
 setModal(null);
 };
 
 const rotate = () => {
 setLineup(prev => ({ p1: prev.p2, p2: prev.p3, p3: prev.p4, p4: prev.p5, p5: prev.p6, p6: prev.p1 }));
 setGameState(prev => ({ ...prev, rotation: (prev.rotation % 6) + 1 }));
 };

 const logServeAttempt = (serverId) => {
 if (!serverId) return;
 const increment = (stats) => {
 const newStats = JSON.parse(JSON.stringify(stats));
 if (!newStats[serverId]) newStats[serverId] = {};
 newStats[serverId]['Serve Attempt'] = (newStats[serverId]['Serve Attempt'] || 0) + 1;
 return newStats;
 };
 setPlayerStats(prev => increment(prev));
 setSetStats(prev => increment(prev));
 };

 const awardPoint = (scoringTeam, reason) => {
 const servingTeamBeforePoint = gameState.servingTeam;
 const serverBeforePoint = lineup.p1;
 
 if (servingTeamBeforePoint === 'home') {
 logServeAttempt(serverBeforePoint);
 } else if (scoringTeam === 'home' && ['Kill', 'KWDA', 'Block', 'Opponent Error'].includes(reason)) {
 // This is a sideout, the new server gets the attempt
 const nextServerId = lineup.p2;
 logServeAttempt(nextServerId);
 }

 const wasOpponentServing = servingTeamBeforePoint === 'opponent';
 const currentRotation = gameState.rotation;

 setRotationScores(prevScores => {
 const newScores = { ...prevScores };
 if (!newScores[currentRotation]) newScores[currentRotation] = { home: 0, opponent: 0 };
 if (scoringTeam === 'home') { newScores[currentRotation].home += 1; } 
 else { newScores[currentRotation].opponent += 1; }
 return newScores;
 });

 setGameState(prev => ({
 ...prev,
 homeScore: prev.homeScore + (scoringTeam === 'home' ? 1 : 0),
 opponentScore: prev.opponentScore + (scoringTeam === 'opponent' ? 1 : 0),
 servingTeam: scoringTeam,
 }));
 if (scoringTeam === 'home' && wasOpponentServing) rotate();
 };
 
 // --- Stat Logic ---
 const handleStatClick = (stat) => {
 saveToHistory();
 const nonPlayerStats = ['Opponent Error', 'Opponent Point'];
 if (nonPlayerStats.includes(stat)) {
 if (stat === 'Opponent Error') {
 awardPoint('home', 'Opponent Error');
 setPointLog(prev => [`H: Opponent Error!`, ...prev]);
 } else {
 awardPoint('opponent', 'Opponent Point');
 setPointLog(prev => [`O: Point Opponent`, ...prev]);
 }
 return;
 }

 const servingStats = ['Ace', 'Serve Error'];
 if (servingStats.includes(stat)) {
 if (gameState.servingTeam !== 'home') {
 handleUndo();
 setModal('not-serving-error');
 return;
 }
 const serverId = lineup.p1;
 if (serverId) assignStatToPlayer(serverId, stat);
 return;
 }

 if (stat === 'RE' && gameState.servingTeam === 'home') {
 handleUndo();
 setModal('not-receiving-error');
 return;
 }
 
 setStatToAssign(stat);
 setModal('assign-stat');
 };

 const incrementStats = (stats, playerId, statToLog, currentSetterId) => {
 const newStats = JSON.parse(JSON.stringify(stats));
 const increment = (pId, s) => {
 if (!newStats[pId]) newStats[pId] = {};
 newStats[pId][s] = (newStats[pId][s] || 0) + 1;
 };

 increment(playerId, statToLog);

 if (['Kill', 'Hit Error', 'Hit Attempt'].includes(statToLog)) {
 increment(playerId, 'Hit Attempt');
 }
 if (['Assist', 'Set Error'].includes(statToLog)) {
 increment(playerId, 'Set Attempt');
 }
 if (statToLog === 'Kill' && currentSetterId && currentSetterId !== playerId) {
 increment(currentSetterId, 'Assist');
 increment(currentSetterId, 'Set Attempt');
 }
 return newStats;
 };

 const assignStatToPlayer = (playerId, stat) => {
 const statToLog = stat || statToAssign;
 const player = roster.find(p => p.id === playerId);
 if (!statToLog || !player) return;

 // Illegal Block Check
 if (statToLog === 'Block') {
 const playerPosition = Object.keys(lineup).find(pos => lineup[pos] === playerId);
 if (['p1', 'p5', 'p6'].includes(playerPosition)) {
 setModal('illegal-block');
 return;
 }
 }

 if (statToLog === 'KWDA') {
 handleKwdaSelection(playerId);
 return;
 }

 setPlayerStats(prev => incrementStats(prev, playerId, statToLog, setterId));
 setSetStats(prev => incrementStats(prev, playerId, statToLog, setterId));

 let pointWinner = null;
 let logMessage = `H: ${statToLog} by #${player.number} ${player.name}`;
 switch(statToLog) {
 case 'Ace': case 'Kill': case 'Block': pointWinner = 'home'; break;
 case 'Serve Error': case 'Hit Error': case 'Set Error': case 'RE': case 'Block Error':
 pointWinner = 'opponent';
 logMessage = `O: ${statToLog} by #${player.number} ${player.name}`;
 break;
 }
 if (pointWinner) awardPoint(pointWinner, statToLog);
 setPointLog(prev => [logMessage, ...prev]);
 setModal(null);
 setStatToAssign(null);
 };

 const handleKwdaSelection = (attackerId) => {
 const player = roster.find(p => p.id === attackerId);
 if (!player) return;

 const updateKwdaStats = (stats) => {
 const newStats = JSON.parse(JSON.stringify(stats));
 const increment = (pId, s) => {
 if (!newStats[pId]) newStats[pId] = {};
 newStats[pId][s] = (newStats[pId][s] || 0) + 1;
 };
 increment(attackerId, 'Kill');
 increment(attackerId, 'Hit Attempt');
 return newStats;
 };

 setPlayerStats(prev => updateKwdaStats(prev));
 setSetStats(prev => updateKwdaStats(prev));

 awardPoint('home', 'KWDA');
 setPointLog(prev => [`H: KWDA Kill by #${player.number} ${player.name}`, ...prev]);
 setKwdaAttackerId(attackerId);
 setModal('assign-kwda-assist');
 };

 const assignKwdaAssist = (assistPlayerId) => {
 const player = roster.find(p => p.id === assistPlayerId);
 if (!player) return;

 const updateAssistStats = (stats) => {
 const newStats = JSON.parse(JSON.stringify(stats));
 const increment = (pId, s) => {
 if (!newStats[pId]) newStats[pId] = {};
 newStats[pId][s] = (newStats[pId][s] || 0) + 1;
 };
 increment(assistPlayerId, 'Assist');
 increment(assistPlayerId, 'Set Attempt');
 return newStats;
 };

 setPlayerStats(prev => updateAssistStats(prev));
 setSetStats(prev => updateAssistStats(prev));

 setPointLog(prev => [`H: Assist by #${player.number} ${player.name}`, ...prev]);
 setModal(null);
 setStatToAssign(null);
 setKwdaAttackerId(null);
 };
 
 // --- Sub Logic ---
 const handleSubClick = (position, playerOutId) => {
 if (!playerOutId) return;
 setSubTarget({ position, playerOutId });
 setModal('substitute');
 };

 const executeSubstitution = (playerInId) => {
 saveToHistory();
 const { position, playerOutId } = subTarget;
 const outGroup = subGroups[playerOutId];
 const inGroup = subGroups[playerInId];

 if (inGroup && inGroup !== outGroup) { setModal('illegal-sub'); return; }

 setLineup(prev => ({ ...prev, [position]: playerInId }));
 setBench(prev => [...prev.filter(p => p.id !== playerInId), roster.find(p => p.id === playerOutId)]);
 
 if (!inGroup) {
 const newSubGroups = { ...subGroups };
 outGroup.add(playerInId);
 newSubGroups[playerInId] = outGroup;
 setSubGroups(newSubGroups);
 }
 setGameState(prev => ({ ...prev, homeSubs: prev.homeSubs + 1 }));
 setModal(null);
 };

 // --- Lineup Setup Logic ---
 const handleCourtClickForLineup = (position) => {
 if (setupStep === 'players') {
 if (!lineup[position]) { // If position is empty, open modal to select a player
 setSubTarget({ position, playerOutId: null });
 setModal('lineup-player-select');
 } else { // If position is already filled, clear it to allow correction
 const lineupIsFullBeforeRemoval = Object.values(lineup).every(p => p !== null);
 if (lineupIsFullBeforeRemoval) {
 setSetupStep('players'); // Go back to player selection step
 }
 setLineup(prev => ({ ...prev, [position]: null }));
 }
 } else if (setupStep === 'setter') {
 const playerId = lineup[position];
 if (playerId) {
 setSetterId(playerId);
 setModal('select-server');
 }
 }
 };

 const handlePlayerSelectForLineup = (playerId) => {
 const { position } = subTarget;
 const newLineup = {...lineup, [position]: playerId};
 setLineup(newLineup);
 const lineupIsFull = Object.values(newLineup).every(p => p !== null);
 if (lineupIsFull) {
 setSetupStep('libero');
 }
 setModal(null);
 };

 const handleLiberoSelect = (playerId) => {
 setLibero(playerId);
 setSetupStep('setter');
 };

 // --- Render Functions ---
 const renderCourt = (isSetupMode = false) => {
 const courtOrder = ['p4', 'p3', 'p2', 'p5', 'p6', 'p1'];
 return courtOrder.map(pos => {
 const playerId = lineup[pos];
 const player = roster.find(p => p.id === playerId);
 return (
 <PlayerCard 
 key={pos} 
 player={player} 
 isSetter={playerId === setterId} 
 onClick={() => isSetupMode ? handleCourtClickForLineup(pos) : handleSubClick(pos, playerId)} 
 />
 );
 });
 };
 
 // --- UI Components ---
 const Scoreboard = () => (
 <div className="bg-gray-900 p-4 rounded-lg shadow-lg flex justify-around items-center text-white mb-4">
 <div className="text-center"><div className="text-lg text-cyan-400">HOME</div><div className="text-5xl font-bold">{gameState.homeScore}</div><div className="text-sm">Sets: {gameState.homeSetsWon}</div></div>
 <div className="text-center">
 <div className="text-sm">SET {gameState.currentSet}</div>
 <div className="text-lg font-bold">Rotation {gameState.rotation}</div>
 <div className={`text-xs p-1 rounded mt-1 ${gameState.servingTeam === 'home' ? 'bg-green-500' : 'bg-gray-600'}`}>HOME SERVE</div>
 <div className={`text-xs p-1 rounded mt-1 ${gameState.servingTeam === 'opponent' ? 'bg-green-500' : 'bg-gray-600'}`}>OPP SERVE</div>
 <div className="text-sm mt-2">SUBS: {gameState.homeSubs}</div>
 </div>
 <div className="text-center"><div className="text-lg text-red-400">OPPONENT</div><div className="text-5xl font-bold">{gameState.opponentScore}</div><div className="text-sm">Sets: {gameState.opponentSetsWon}</div></div>
 </div>
 );
 
 const StatButton = ({ label, onClick, type }) => {
 const colors = { positive: 'bg-green-600 hover:bg-green-500', neutral: 'bg-blue-600 hover:bg-blue-500', negative: 'bg-red-600 hover:bg-red-500' };
 return (<button onClick={onClick} className={`text-white font-bold py-3 px-2 rounded-lg shadow-md transition-transform transform hover:scale-105 ${colors[type]}`}>{label}</button>);
 };

 const StatPanel = () => (
 <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
 <div className="bg-gray-800 p-3 rounded-lg"><h3 className="text-cyan-400 font-bold text-center mb-2">SERVING</h3><div className="grid grid-cols-1 gap-2"><StatButton label="Ace" onClick={() => handleStatClick('Ace')} type="positive" /><StatButton label="Serve Error" onClick={() => handleStatClick('Serve Error')} type="negative" /></div></div>
 <div className="bg-gray-800 p-3 rounded-lg"><h3 className="text-cyan-400 font-bold text-center mb-2">HITTING</h3><div className="grid grid-cols-1 gap-2"><StatButton label="Kill" onClick={() => handleStatClick('Kill')} type="positive" /><StatButton label="KWDA" onClick={() => handleStatClick('KWDA')} type="positive" /><StatButton label="Hit Attempt" onClick={() => handleStatClick('Hit Attempt')} type="neutral" /><StatButton label="Hit Error" onClick={() => handleStatClick('Hit Error')} type="negative" /></div></div>
 <div className="bg-gray-800 p-3 rounded-lg"><h3 className="text-cyan-400 font-bold text-center mb-2">SETTING</h3><div className="grid grid-cols-1 gap-2"><StatButton label="Assist" onClick={() => handleStatClick('Assist')} type="neutral" /><StatButton label="Set Error" onClick={() => handleStatClick('Set Error')} type="negative" /></div></div>
 <div className="bg-gray-800 p-3 rounded-lg"><h3 className="text-cyan-400 font-bold text-center mb-2">DEFENSE</h3><div className="grid grid-cols-1 gap-2"><StatButton label="Dig" onClick={() => handleStatClick('Dig')} type="neutral" /><StatButton label="Block" onClick={() => handleStatClick('Block')} type="positive" /><StatButton label="RE" onClick={() => handleStatClick('RE')} type="negative" /><StatButton label="Block Error" onClick={() => handleStatClick('Block Error')} type="negative" /></div></div>
 <div className="bg-gray-800 p-3 rounded-lg"><h3 className="text-cyan-400 font-bold text-center mb-2">GAME</h3><div className="grid grid-cols-1 gap-2"><StatButton label="Opponent Error" onClick={() => handleStatClick('Opponent Error')} type="positive" /><StatButton label="Opponent Point" onClick={() => handleStatClick('Opponent Point')} type="negative" /></div></div>
 </div>
 );

 const StatsTable = ({ statsData, rosterData }) => {
 const currentRoster = rosterData || roster;
 const STAT_ORDER = ['Serve Attempt', 'Ace', 'Serve Error', 'Hit Attempt', 'Kill', 'Hit Error', 'Set Attempt', 'Assist', 'Set Error', 'Block', 'Block Error', 'Dig', 'RE'];
 const calculateHittingPercentage = (stats) => {
 if (!stats) return '.000';
 const kills = stats['Kill'] || 0;
 const errors = stats['Hit Error'] || 0;
 const attempts = stats['Hit Attempt'] || 0;
 if (attempts === 0) return '.000';
 return ((kills - errors) / attempts).toFixed(3);
 };
 const teamTotals = STAT_ORDER.reduce((acc, stat) => {
 acc[stat] = currentRoster.reduce((total, player) => total + (statsData[player.id]?.[stat] || 0), 0);
 return acc;
 }, {});

 return (
 <div className="p-3 overflow-x-auto">
 <table className="w-full text-sm text-left">
 <thead className="text-xs text-cyan-400 uppercase bg-gray-700"><tr><th className="px-4 py-2">Player</th>{STAT_ORDER.map(stat => <th key={stat} className="px-2 py-2 text-center">{stat.replace('Attempt', 'Att').replace('Error', 'Err')}</th>)}<th className="px-2 py-2 text-center">Hit %</th></tr></thead>
 <tbody>{currentRoster.map(player => (<tr key={player.id} className="border-b border-gray-700"><td className="px-4 py-2 font-medium whitespace-nowrap">#{player.number} {player.name}</td>{STAT_ORDER.map(stat => (<td key={stat} className="px-2 py-2 text-center">{statsData[player.id]?.[stat] || 0}</td>))}<td className="px-2 py-2 text-center">{calculateHittingPercentage(statsData[player.id])}</td></tr>))}</tbody>
 <tfoot><tr className="font-bold text-cyan-400 bg-gray-700"><td className="px-4 py-2">TEAM TOTAL</td>{STAT_ORDER.map(stat => (<td key={stat} className="px-2 py-2 text-center">{teamTotals[stat]}</td>))}<td className="px-2 py-2 text-center">{calculateHittingPercentage(teamTotals)}</td></tr></tfoot>
 </table>
 </div>
 );
 };
 
 const SeasonStatsTable = () => {
 const STAT_ORDER = ['Serve Attempt', 'Ace', 'Serve Error', 'Hit Attempt', 'Kill', 'Hit Error', 'Set Attempt', 'Assist', 'Set Error', 'Block', 'Block Error', 'Dig', 'RE'];
 const calculateHittingPercentage = (stats) => {
 if (!stats) return '.000';
 const kills = stats['Kill'] || 0;
 const errors = stats['Hit Error'] || 0;
 const attempts = stats['Hit Attempt'] || 0;
 if (attempts === 0) return '.000';
 return ((kills - errors) / attempts).toFixed(3);
 };
 
 const uniquePlayers = [];
 const playerNumbers = new Set();
 if (seasonStats.players) {
 seasonStats.players.forEach(p => {
 if (!playerNumbers.has(p.number)) {
 uniquePlayers.push(p);
 playerNumbers.add(p.number);
 }
 });
 }
 
 const teamTotals = STAT_ORDER.reduce((acc, stat) => {
 acc[stat] = Object.values(seasonStats.stats || {}).reduce((total, playerData) => total + (playerData.stats[stat] || 0), 0);
 return acc;
 }, {});
 
 return (
 <div className="p-3 overflow-x-auto">
 <table className="w-full text-sm text-left">
 <thead className="text-xs text-cyan-400 uppercase bg-gray-700">
 <tr>
 <th className="px-4 py-2">Player</th>
 {STAT_ORDER.map(stat => <th key={stat} className="px-2 py-2 text-center">{stat.replace('Attempt', 'Att').replace('Error', 'Err')}</th>)}
 <th className="px-2 py-2 text-center">Hit %</th>
 </tr>
 </thead>
 <tbody>
 {uniquePlayers.map(player => {
 const playerData = Object.values(seasonStats.stats || {}).find(p => p.number === player.number);
 const playerStats = playerData ? playerData.stats : {};
 return (
 <tr key={player.id} className="border-b border-gray-700">
 <td className="px-4 py-2 font-medium whitespace-nowrap">#{player.number} {player.name}</td>
 {STAT_ORDER.map(stat => <td key={stat} className="px-2 py-2 text-center">{playerStats[stat] || 0}</td>)}
 <td className="px-2 py-2 text-center">{calculateHittingPercentage(playerStats)}</td>
 </tr>
 );
 })}
 </tbody>
 <tfoot>
 <tr className="font-bold text-cyan-400 bg-gray-700">
 <td className="px-4 py-2">TEAM TOTAL</td>
 {STAT_ORDER.map(stat => <td key={stat} className="px-2 py-2 text-center">{teamTotals[stat]}</td>)}
 <td className="px-2 py-2 text-center">{calculateHittingPercentage(teamTotals)}</td>
 </tr>
 </tfoot>
 </table>
 </div>
 );
 };

 const TabbedDisplay = () => (
 <div className="mt-4 bg-gray-800 rounded-lg">
 <div className="flex border-b border-gray-700 items-center flex-wrap">
 <button onClick={() => setActiveTab('set_stats')} className={`py-2 px-4 font-bold ${activeTab === 'set_stats' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Set Stats</button>
 <button onClick={() => setActiveTab('match_stats')} className={`py-2 px-4 font-bold ${activeTab === 'match_stats' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Match Stats</button>
 <button onClick={() => { setActiveTab('season_stats'); calculateSeasonStats(); }} className={`py-2 px-4 font-bold ${activeTab === 'season_stats' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Season Stats</button>
 <button onClick={() => setActiveTab('log')} className={`py-2 px-4 font-bold ${activeTab === 'log' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Point Log</button>
 <button onClick={() => setActiveTab('rotations')} className={`py-2 px-4 font-bold ${activeTab === 'rotations' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Rotation Tracker</button>
 <div className="flex-grow"></div>
 <button onClick={handleUndo} disabled={history.length === 0} className="py-2 px-4 font-bold text-yellow-400 hover:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed">Undo</button>
 </div>
 {activeTab === 'set_stats' && <StatsTable statsData={setStats} rosterData={roster} />}
 {activeTab === 'match_stats' && <StatsTable statsData={playerStats} rosterData={roster} />}
 {activeTab === 'season_stats' && <SeasonStatsTable />}
 {activeTab === 'log' && (<div className="p-3"><ul className="text-sm h-64 overflow-y-auto flex flex-col-reverse">{pointLog.map((log, i) => <li key={i} className="p-1 border-b border-gray-700">{log}</li>)}</ul></div>)}
 {activeTab === 'rotations' && (<div className="p-3"><table className="w-full text-sm text-left">
 <thead className="text-xs text-cyan-400 uppercase bg-gray-700"><tr><th className="px-4 py-2">Rotation</th><th className="px-4 py-2 text-center">Home Points</th><th className="px-4 py-2 text-center">Opponent Points</th><th className="px-4 py-2 text-center">+/-</th></tr></thead>
 <tbody>{Object.keys(rotationScores).map(rNum => { const s = rotationScores[rNum] || {home: 0, opponent: 0}; const d = s.home - s.opponent; return (<tr key={rNum} className={`${d > 0 ? 'bg-green-900/50' : d < 0 ? 'bg-red-900/50' : ''} border-b border-gray-700`}><td className="px-4 py-2 font-medium">Rotation {rNum}</td><td className="px-4 py-2 text-center">{s.home}</td><td className="px-4 py-2 text-center">{s.opponent}</td><td className="px-4 py-2 text-center font-bold">{d > 0 ? `+${d}` : d}</td></tr>);})}</tbody>
 </table></div>)}
 </div>
 );
 
 const LineupSetup = () => {
 const lineupPlayerIds = Object.values(lineup).map(p => p);
 const availableForLibero = roster.filter(p => !lineupPlayerIds.includes(p.id));
 const setupInstructions = {
 players: `Set ${gameState.currentSet}: Click a court position to set your lineup. Click a player to remove them.`,
 libero: `Set ${gameState.currentSet}: Select your Libero from the available players.`,
 setter: `Set ${gameState.currentSet}: Click a player on the court to designate them as the Setter.`,
 };

 return (
 <div>
 <div className="p-4 text-center bg-gray-800 rounded-lg mb-4"><h2 className="text-xl font-bold text-cyan-400">{setupInstructions[setupStep]}</h2></div>
 <h2 className="text-xl font-bold text-center mb-2 text-cyan-400">Set Initial Lineup</h2>
 <div className="grid grid-cols-3 gap-4 mb-4">{renderCourt(true)}</div>
 {setupStep === 'libero' && (
 <>
 <h2 className="text-xl font-bold text-center mb-2 text-cyan-400">Available for Libero</h2>
 <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
 {availableForLibero.map(p => (<div key={p.id} onClick={() => handleLiberoSelect(p.id)} className="bg-gray-700 p-2 rounded text-center cursor-pointer hover:bg-gray-600"><div>#{p.number}</div><div>{p.name}</div></div>))}
 </div>
 </>
 )}
 </div>
 );
 };

 // --- Modal Content Components ---
 const RosterModal = () => {
 const [localRoster, setLocalRoster] = useState([{ number: '', name: '' }]);
 const [localMatchName, setLocalMatchName] = useState('');
 const addPlayer = () => setLocalRoster([...localRoster, { number: '', name: '' }]);
 const updatePlayer = (index, field, value) => {
 if (field === 'number' && value && parseInt(value, 10) < 0) return;
 const newRoster = [...localRoster];
 newRoster[index][field] = value;
 setLocalRoster(newRoster);
 };
 const handleSubmit = (e) => { e.preventDefault(); const filtered = localRoster.filter(p => p.number && p.name); if (filtered.length < 6) { alert("Please enter at least 6 players."); return; } handleSaveRoster(filtered, localMatchName); };
 return (<form onSubmit={handleSubmit}>
 <input type="text" placeholder="Match Name (e.g., vs. Rival High)" value={localMatchName} onChange={(e) => setLocalMatchName(e.target.value)} className="bg-gray-700 p-2 rounded w-full mb-4" required />
 <div className="space-y-3 max-h-80 overflow-y-auto pr-2">{localRoster.map((p, i) => (<div key={i} className="flex items-center space-x-2"><input type="number" placeholder="#" value={p.number} min="0" onChange={(e) => updatePlayer(i, 'number', e.target.value)} className="bg-gray-700 p-2 rounded w-20 text-center" required /><input type="text" placeholder="Player Name" value={p.name} onChange={(e) => updatePlayer(i, 'name', e.target.value)} className="bg-gray-700 p-2 rounded w-full" required /></div>))}</div>
 <button type="button" onClick={addPlayer} className="mt-4 w-full bg-gray-600 hover:bg-gray-500 p-2 rounded">Add Player</button>
 <button type="submit" className="mt-2 w-full bg-cyan-600 hover:bg-cyan-500 p-2 rounded font-bold">Save Roster & Start Match</button>
 </form>);
 };

 const LoadMatchModal = () => (
 <div>
 {savedMatches.length === 0 ? <p>No saved matches found.</p> : (
 <div className="space-y-2 max-h-80 overflow-y-auto">
 {savedMatches.sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved)).map(match => (
 <button key={match.id} onClick={() => loadSpecificMatch(match)} className="w-full text-left bg-gray-700 hover:bg-gray-600 p-3 rounded">
 <span className="font-bold">{match.matchName}</span>
 <span className="text-sm text-gray-400 block">Last saved: {new Date(match.lastSaved).toLocaleString()}</span>
 </button>
 ))}
 </div>
 )}
 </div>
 );

 const LineupPlayerSelectModal = () => {
 const lineupPlayerIds = Object.values(lineup).map(p => p);
 const availablePlayers = roster.filter(p => !lineupPlayerIds.includes(p.id) && p.id !== libero);
 return (<div><p className="mb-4">Select a player for position <span className="font-bold text-cyan-400">{subTarget.position?.toUpperCase()}</span></p><div className="space-y-2 max-h-80 overflow-y-auto">{availablePlayers.map(player => (<button key={player.id} onClick={() => handlePlayerSelectForLineup(player.id)} className="w-full text-left bg-gray-700 hover:bg-gray-600 p-3 rounded">#{player.number} {player.name}</button>))}</div></div>);
 };
 
 const SelectServerModal = () => (<div><p className="mb-4 font-bold">Who is serving first?</p><div className="flex justify-around"><button onClick={() => handleStartSet('home')} className="bg-cyan-600 hover:bg-cyan-500 p-3 rounded-lg w-32 font-bold">Home</button><button onClick={() => handleStartSet('opponent')} className="bg-red-600 hover:bg-red-500 p-3 rounded-lg w-32 font-bold">Opponent</button></div></div>);
 const SubstituteModal = () => (<div><p className="mb-4">Select a player from the bench to substitute in.</p><div className="space-y-2 max-h-80 overflow-y-auto">{bench.map(player => (<button key={player.id} onClick={() => executeSubstitution(player.id)} className="w-full text-left bg-gray-700 hover:bg-gray-600 p-3 rounded">#{player.number} {player.name}</button>))}</div></div>);
 const AssignStatModal = () => {
 const onCourtIds = [...Object.values(lineup), libero].filter(Boolean);
 const onCourtPlayers = roster.filter(p => onCourtIds.includes(p.id));
 return (<div><p className="mb-4">Assign <span className="font-bold text-cyan-400">{statToAssign}</span> to:</p><div className="space-y-2 max-h-80 overflow-y-auto">{onCourtPlayers.map(player => (<button key={player.id} onClick={() => assignStatToPlayer(player.id)} className="w-full text-left bg-gray-700 hover:bg-gray-600 p-3 rounded">#{player.number} {player.name}</button>))}</div></div>);
 };
 const AssignKwdaAssistModal = () => {
 const onCourtIds = [...Object.values(lineup), libero].filter(Boolean);
 const onCourtPlayers = roster.filter(p => onCourtIds.includes(p.id) && p.id !== kwdaAttackerId);
 return (<div><p className="mb-4">Assign <span className="font-bold text-cyan-400">Assist</span> for KWDA to:</p><div className="space-y-2 max-h-80 overflow-y-auto">{onCourtPlayers.map(player => (<button key={player.id} onClick={() => assignKwdaAssist(player.id)} className="relative w-full text-left bg-gray-700 hover:bg-gray-600 p-3 rounded">#{player.number} {player.name} {player.id === setterId && <SetterIcon />}</button>))}</div></div>);
 };

 // --- Main Render ---
 return (
 <div className="bg-gray-900 min-h-screen text-white font-sans p-4">
 <div className="container mx-auto max-w-5xl">

 {matchPhase === 'pre_match' && (
 <div className="flex flex-col items-center justify-center h-screen">
 <h1 className="text-4xl font-bold mb-4 text-cyan-400">Volleyball Stat Tracker</h1>
 <div className="space-y-4">
 <button onClick={handleStartNewMatch} className="w-64 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 px-6 rounded-lg text-xl">Start New Match</button>
 <button onClick={loadMatchesFromFirebase} disabled={!isAuthReady} className="w-64 bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-lg text-xl disabled:bg-gray-700 disabled:cursor-not-allowed">Load Match</button>
 </div>
 </div>
 )}
 
 {matchPhase === 'post_match' && (
 <div className="text-center p-8">
 <h1 className="text-4xl font-bold text-cyan-400 mb-4">Match Over</h1>
 <Scoreboard />
 <TabbedDisplay />
 <button onClick={() => setMatchPhase('pre_match')} className="mt-8 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 px-6 rounded-lg text-xl">Return to Main Menu</button>
 </div>
 )}

 {matchPhase === 'lineup_setup' && <LineupSetup />}

 {matchPhase === 'playing' && (
 <>
 <Scoreboard />
 <div className="flex justify-end space-x-2 mb-4">
 <button onClick={() => setModal('end-set-confirm')} className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-lg">End Current Set</button>
 <button onClick={saveMatchToFirebase} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-lg">Save Match</button>
 </div>
 <h2 className="text-xl font-bold text-center mb-2 text-cyan-400">Court</h2>
 <div className="grid grid-cols-3 gap-4 mb-4">{renderCourt(false)}</div>
 
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
 <div className="md:col-span-1 flex flex-col items-center">
 <h2 className="text-xl font-bold mb-2 text-cyan-400">Libero</h2>
 <div className="w-32">
 <PlayerCard player={roster.find(p => p.id === libero)} isSetter={libero === setterId} />
 </div>
 </div>
 <div className="md:col-span-2">
 <h2 className="text-xl font-bold text-center md:text-left mb-2 text-cyan-400">Bench</h2>
 <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2">
 {bench.map(p => (
 <div key={p.id} className="bg-gray-800 p-2 rounded text-center text-sm h-16 flex flex-col justify-center">
 <div>#{p.number}</div>
 <div className="truncate">{p.name}</div>
 </div>
 ))}
 </div>
 </div>
 </div>

 <StatPanel />
 <TabbedDisplay />
 </>
 )}

 <Modal title="Enter Roster" isOpen={modal === 'roster'} onClose={() => setModal(null)}><RosterModal /></Modal>
 <Modal title="Load Match" isOpen={modal === 'load-match'} onClose={() => setModal(null)}><LoadMatchModal /></Modal>
 <Modal title="Select Player" isOpen={modal === 'lineup-player-select'} onClose={() => setModal(null)}><LineupPlayerSelectModal /></Modal>
 <Modal title="Select First Server" isOpen={modal === 'select-server'} onClose={() => setModal(null)}><SelectServerModal /></Modal>
 <Modal title="Substitute Player" isOpen={modal === 'substitute'} onClose={() => setModal(null)}><SubstituteModal /></Modal>
 <Modal title="Assign Stat" isOpen={modal === 'assign-stat'} onClose={() => setModal(null)}><AssignStatModal /></Modal>
 <Modal title="Assign KWDA Assist" isOpen={modal === 'assign-kwda-assist'} onClose={() => setModal(null)}><AssignKwdaAssistModal /></Modal>
 
 <Modal title="Error" isOpen={modal === 'not-serving-error'} onClose={() => setModal(null)}>
 <p>Cannot assign a serving stat when your team is not serving.</p>
 </Modal>
 <Modal title="Error" isOpen={modal === 'not-receiving-error'} onClose={() => setModal(null)}>
 <p>Cannot assign a reception error when your team is serving.</p>
 </Modal>
 <Modal title="Error" isOpen={modal === 'illegal-sub'} onClose={() => setModal(null)}>
 <p>Illegal substitution. This player cannot substitute for the selected player based on the substitution rules for this set.</p>
 </Modal>
 <Modal title="Illegal Action" isOpen={modal === 'illegal-block'} onClose={() => setModal(null)}>
 <p>Back row players can't get a block stat - this is Illegal.</p>
 </Modal>
 <Modal title="Confirm End Set" isOpen={modal === 'end-set-confirm'} onClose={() => setModal(null)}>
 <p className="mb-4">Are you sure you want to end the current set? The scores will be recorded and you will proceed to the next set's lineup.</p>
 <div className="flex justify-end space-x-4">
 <button onClick={() => setModal(null)} className="bg-gray-600 hover:bg-gray-500 p-2 px-4 rounded">Cancel</button>
 <button onClick={handleEndSet} className="bg-red-600 hover:bg-red-500 p-2 px-4 rounded">End Set</button>
 </div>
 </Modal>
 </div>
 </div>
 );
})}