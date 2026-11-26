// Execute after migration 006 with the protected environment configured.
import {seedLists} from '../brain-segments.mjs';
import {closeDatabase} from '../db.mjs';
try {await seedLists();console.log('Listas iniciais conferidas; existentes preservadas.');} finally {await closeDatabase();}
