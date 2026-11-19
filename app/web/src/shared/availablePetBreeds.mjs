/** Keep old identities readable while publishing only companions with finished actions. */
export const DEFAULT_PET_BREED = 'alpaca_toon';
export const AVAILABLE_PET_BREEDS = [DEFAULT_PET_BREED, 'capybara_toon'];
export const isAvailablePetBreed = breed => AVAILABLE_PET_BREEDS.includes(breed);
