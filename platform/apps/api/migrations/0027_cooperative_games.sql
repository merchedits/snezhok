ALTER TABLE cooperative_activities
  DROP CONSTRAINT IF EXISTS cooperative_activities_type_check;

ALTER TABLE cooperative_activities
  ADD CONSTRAINT cooperative_activities_type_check
  CHECK (type IN (
    'question','blitz','tiny-quest','color-hunt','song-exchange',
    'movie-list','draw-guess','ideas-jar','memory-capsule','milestone',
    'tic-tac-toe','chess','checkers','sea-battle','pool'
  ));
