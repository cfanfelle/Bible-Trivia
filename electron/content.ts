import Database from './db.js';
import { contentSchema } from './migrations.js';
import fs from 'node:fs';

export const BOOKS:[string,string,'OT'|'NT',number][]=[
['GEN','Genesis','OT',50],['EXO','Exodus','OT',40],['LEV','Leviticus','OT',27],['NUM','Numbers','OT',36],['DEU','Deuteronomy','OT',34],['JOS','Joshua','OT',24],['JDG','Judges','OT',21],['RUT','Ruth','OT',4],['1SA','1 Samuel','OT',31],['2SA','2 Samuel','OT',24],['1KI','1 Kings','OT',22],['2KI','2 Kings','OT',25],['1CH','1 Chronicles','OT',29],['2CH','2 Chronicles','OT',36],['EZR','Ezra','OT',10],['NEH','Nehemiah','OT',13],['EST','Esther','OT',10],['JOB','Job','OT',42],['PSA','Psalms','OT',150],['PRO','Proverbs','OT',31],['ECC','Ecclesiastes','OT',12],['SNG','Song of Solomon','OT',8],['ISA','Isaiah','OT',66],['JER','Jeremiah','OT',52],['LAM','Lamentations','OT',5],['EZK','Ezekiel','OT',48],['DAN','Daniel','OT',12],['HOS','Hosea','OT',14],['JOL','Joel','OT',3],['AMO','Amos','OT',9],['OBA','Obadiah','OT',1],['JON','Jonah','OT',4],['MIC','Micah','OT',7],['NAM','Nahum','OT',3],['HAB','Habakkuk','OT',3],['ZEP','Zephaniah','OT',3],['HAG','Haggai','OT',2],['ZEC','Zechariah','OT',14],['MAL','Malachi','OT',4],['MAT','Matthew','NT',28],['MRK','Mark','NT',16],['LUK','Luke','NT',24],['JHN','John','NT',21],['ACT','Acts','NT',28],['ROM','Romans','NT',16],['1CO','1 Corinthians','NT',16],['2CO','2 Corinthians','NT',13],['GAL','Galatians','NT',6],['EPH','Ephesians','NT',6],['PHP','Philippians','NT',4],['COL','Colossians','NT',4],['1TH','1 Thessalonians','NT',5],['2TH','2 Thessalonians','NT',3],['1TI','1 Timothy','NT',6],['2TI','2 Timothy','NT',4],['TIT','Titus','NT',3],['PHM','Philemon','NT',1],['HEB','Hebrews','NT',13],['JAS','James','NT',5],['1PE','1 Peter','NT',5],['2PE','2 Peter','NT',3],['1JN','1 John','NT',5],['2JN','2 John','NT',1],['3JN','3 John','NT',1],['JUD','Jude','NT',1],['REV','Revelation','NT',22]
];

const WEB_BOOK_IDS:Record<string,string>={SOL:'SNG',EZE:'EZK',JOE:'JOL',MAR:'MRK',JOH:'JHN',PHI:'PHP',JAM:'JAS','1JO':'1JN','2JO':'2JN','3JO':'3JN'};
export const TRANSLATIONS=[
 {id:'BSB',name:'Berean Standard Bible',abbreviation:'BSB',description:'Modern and balanced',license:'Public Domain',sortOrder:1},
 {id:'WEB',name:'World English Bible',abbreviation:'WEB',description:'Formal modern English',license:'Public Domain',sortOrder:2},
 {id:'KJV',name:'King James Version',abbreviation:'KJV',description:'Traditional English',license:'Public Domain outside the United Kingdom',sortOrder:3}
] as const;
export interface BibleSource {translationId:string;file:string}

export const AVATARS:[string,string,string,number][]=[
 ['lamb','Lamb','🐑',1],
 ['dove','Dove','🕊️',1],
 ['fish','Fish','🐟',1],
 ['donkey','Donkey','🫏',50],
 ['goat','Goat','🐐',208],
 ['camel','Camel','🐫',367],
 ['eagle','Eagle','🦅',525],
 ['deer','Deer','🦌',683],
 ['ox','Ox','🐂',842],
 ['lion','Lion','🦁',1000]
];

const QUESTIONS:[string,string,number,number,number,string,string,string,string,string,number][]=[
 ["ACT-000001","ACT",1,1,2,"Who is traditionally recognized as the author of the book of Acts?","Peter","Paul","Luke","John",2],
 ["ACT-000002","ACT",1,3,3,"For how many days did Jesus appear to his disciples after his resurrection and give many convincing proofs that he was alive?","7 days","12 days","30 days","40 days",3],
 ["ACT-000003","ACT",1,6,7,"When the apostles asked Jesus about the time for restoring the kingdom to Israel, who did Jesus say had set the times and dates by his own authority?","The Father","The Son","The apostles","The prophets",0],
 ["ACT-000004","ACT",2,1,4,"On what day did the Holy Spirit come upon the disciples with a sound like a violent wind and what seemed to be tongues of fire?","Passover","Pentecost","Day of Atonement","Festival of Tabernacles",1],
 ["ACT-000005","ACT",2,14,21,"Who stood up and addressed the crowd, declaring that everyone who calls on the name of the Lord will be saved?","John","Stephen","Peter","James",2],
 ["ACT-000006","ACT",4,1,2,"Why were the priests, captain of the temple guard, and Sadducees disturbed by Peter and John?","They were collecting money at the temple","They were teaching the people and proclaiming the resurrection of the dead in Jesus","They refused to enter the temple","They were telling the people to leave Jerusalem",1],
 ["ACT-000007","ACT",4,36,36,"What name did the apostles give Joseph, a Levite from Cyprus?","Silas","Barnabas","Matthias","Stephen",1],
 ["ACT-000008","ACT",5,1,10,"What husband and wife died after lying about the money they received from selling property?","Aquila and Priscilla","Felix and Drusilla","Ananias and Sapphira","Herod and Bernice",2],
 ["ACT-000009","ACT",5,17,20,"Who opened the doors of the public jail and released the apostles during the night?","Peter","A Roman guard","Gamaliel","An angel of the Lord",3],
 ["ACT-000010","ACT",5,29,29,"Who did Peter and the other apostles say they must obey rather than human beings?","The high priest","God","Caesar","Moses",1],
 ["ACT-000011","ACT",6,8,15,"Who was full of God’s grace and power and was brought before the Sanhedrin after false witnesses testified against him?","Stephen","Philip","Barnabas","Matthias",0],
 ["ACT-000012","ACT",7,2,53,"In his defense before the Sanhedrin, whose history did Stephen recount?","The history of the Roman Empire","The history of Israel and its ancestors","The history of the Philistines","The history of the Egyptian pharaohs",1],
 ["ACT-000013","ACT",7,57,60,"How was Stephen killed?","He was crucified","He was beheaded","He was stoned to death","He was thrown into prison and died there",2],
 ["ACT-000014","ACT",7,59,59,"What did Stephen pray while he was being stoned?","Father, forgive my sins","Lord Jesus, receive my spirit","LORD, deliver me from my enemies","Father, take me to Abraham",1],
 ["ACT-000015","ACT",8,1,3,"Who began destroying the church, going from house to house and dragging off men and women to prison?","Herod","Saul","Caiaphas","Cornelius",1],
 ["ACT-000016","ACT",8,27,28,"Which book of the Bible was the Ethiopian eunuch reading when Philip met him?","Jeremiah","Psalms","Isaiah","Genesis",2],
 ["ACT-000017","ACT",8,34,35,"When the Ethiopian eunuch asked Philip who Isaiah's passage was speaking about, what did Philip do?","He told him the good news about Jesus","He told him to ask the priests in Jerusalem","He explained that the passage referred to Moses","He told him the passage could not be understood",0],
 ["ACT-000018","ACT",9,3,4,"What did Jesus ask Saul on the road to Damascus?","Saul, Saul, where are you going?","Saul, Saul, why do you persecute me?","Saul, Saul, do you believe in me?","Saul, Saul, why have you left Jerusalem?",1],
 ["ACT-000019","ACT",9,6,6,"What did Jesus tell Saul to do on the road to Damascus?","Return immediately to Jerusalem","Go into the wilderness and pray","Get up and go into the city, where he would be told what to do","Find Peter and bring him to Jerusalem",2],
 ["ACT-000020","ACT",9,9,9,"How long was Saul blind after his encounter with Jesus on the road to Damascus?","One day","Three days","Seven days","Forty days",1],
 ["ACT-000021","ACT",9,10,18,"Who did the Lord send to Saul so that Saul could regain his sight?","Peter","Philip","Barnabas","Ananias",3],
 ["ACT-000022","ACT",9,15,16,"What did the Lord tell Ananias about Saul?","Saul would return to his former life in Tarsus","Saul was God’s chosen instrument to proclaim his name to the Gentiles, their kings, and the people of Israel","Saul would become the high priest in Jerusalem","Saul would only preach to the Jewish people",1],
 ["ACT-000023","ACT",9,32,35,"Who did Peter heal in Lydda after the man had been paralyzed and bedridden for eight years?","Aeneas","Cornelius","Simon","Agabus",0],
 ["ACT-000024","ACT",9,36,41,"Who did Peter raise from the dead in Joppa?","Lydia, also called Priscilla","Tabitha, also called Dorcas","Sapphira, also called Martha","Rhoda, also called Mary",1],
 ["ACT-000025","ACT",13,9,9,"What other name was Saul known by?","Silas","Paul","Barnabas","Apollos",1],
 ["ACT-000026","ACT",22,25,29,"In addition to being Jewish, what citizenship did Paul possess?","Greek citizenship","Egyptian citizenship","Roman citizenship","Syrian citizenship",2],
 ["ACT-000027","ACT",9,23,25,"How did Saul escape from Damascus when people were plotting to kill him?","He disguised himself as a Roman soldier","His disciples lowered him in a basket through an opening in the city wall","He escaped through the city gates at night","An angel led him out of the city",1],
 ["ACT-000028","ACT",10,9,35,"What did Peter learn from his vision of the sheet containing various animals?","Only the Israelites could receive salvation","God does not show favoritism but accepts from every nation those who fear him and do what is right","The apostles should stop preaching to Gentiles","Peter should return immediately to Jerusalem",1],
 ["ACT-000029","ACT",10,42,42,"What did Peter tell Cornelius and those with him that Jesus had commanded the apostles to do?","Build churches throughout Judea","Preach to the people and testify that Jesus is the one appointed by God as judge of the living and the dead","Return to Jerusalem and wait for another sign","Teach only the people of Israel",1],
 ["ACT-000030","ACT",11,26,26,"Where were the disciples first called Christians?","Jerusalem","Rome","Antioch","Damascus",2],
 ["ACT-000031","ACT",11,25,26,"Who went to Tarsus to look for Saul and brought him to Antioch?","Peter","Barnabas","James","Silas",1],
 ["ACT-000032","ACT",12,21,23,"Why was Herod struck down by an angel of the Lord and then eaten by worms?","He imprisoned Peter","He refused to leave Jerusalem","He did not give praise to God","He persecuted Barnabas",2],
 ["ACT-000033","ACT",13,6,11,"Who did Paul temporarily blind in Paphos after confronting him for opposing the faith?","Simon the Sorcerer","Elymas the sorcerer, also called Bar-Jesus","Sergius Paulus","Alexander the metalworker",1],
 ["ACT-000034","ACT",13,44,45,"Why did some of the Jewish leaders contradict what Paul was saying and heap abuse on him?","They were afraid of the Romans","They were jealous","They disagreed about where Paul was born","They wanted Paul to leave the synagogue",1],
 ["ACT-000035","ACT",14,8,13,"In what city did the crowd try to offer sacrifices to Barnabas and Paul, believing they were the gods Zeus and Hermes?","Antioch","Iconium","Lystra","Corinth",2],
 ["ACT-000036","ACT",15,1,6,"What issue caused a major dispute among the believers and was considered by the apostles and elders in Jerusalem?","Whether Gentile believers had to be circumcised according to the custom taught by Moses in order to be saved","Whether Christians could preach outside Jerusalem","Whether Paul should return to Tarsus","Whether believers were allowed to enter synagogues",0],
 ["ACT-000037","ACT",15,36,40,"What disagreement caused Paul and Barnabas to separate from each other?","Whether they should return to Jerusalem","Whether they should take John Mark with them on their journey","Whether they should preach to Gentiles","Whether they should travel to Macedonia",1],
 ["ACT-000038","ACT",16,1,1,"Where did Paul meet Timothy?","Corinth","Ephesus","Lystra","Philippi",2],
 ["ACT-000039","ACT",16,9,10,"How did Paul know that he and his companions were being called to preach the gospel in Macedonia?","Peter sent him a letter","An angel appeared to Silas","Paul had a vision of a man of Macedonia asking him to come and help them","Timothy received a message from Jerusalem",2],
 ["ACT-000040","ACT",16,16,24,"What event led to Paul and Silas being seized, beaten, and imprisoned in Philippi?","Paul refused to pay a Roman tax","Paul commanded a spirit of fortune-telling to leave a slave girl, causing her owners to lose their source of income","Paul destroyed a pagan temple","Paul publicly insulted the city officials",1],
 ["ACT-000041","ACT",17,1,3,"What was Paul's custom when he came to a town with a Jewish synagogue?","He avoided the synagogue and preached only in the marketplace","He entered the synagogue on the Sabbath and reasoned from the Scriptures that Jesus was the Messiah","He waited for the synagogue leaders to invite him to speak","He preached only to Gentiles outside the city",1],
 ["ACT-000042","ACT",17,13,15,"Where were Paul, Silas, and Timothy when Paul was sent away toward the coast while Silas and Timothy remained behind?","Athens","Thessalonica","Berea","Corinth",2],
 ["ACT-000043","ACT",18,2,3,"What trade did Paul share with Aquila and Priscilla while staying with them in Corinth?","Fishing","Carpentry","Tentmaking","Metalworking",2],
 ["ACT-000044","ACT",18,5,5,"Where was Paul when Silas and Timothy rejoined him after coming from Macedonia?","Ephesus","Corinth","Athens","Philippi",1],
 ["ACT-000045","ACT",18,11,11,"How long did Paul stay in Corinth, teaching the word of God?","Six months","One year","A year and a half","Three years",2],
 ["ACT-000046","ACT",19,4,4,"John the Baptist's baptism was a baptism of what?","Repentance","Healing","Prophecy","Purification",0],
 ["ACT-000047","ACT",19,23,28,"What goddess was widely worshiped in Ephesus?","Athena","Hera","Artemis","Aphrodite",2],
 ["ACT-000048","ACT",20,7,12,"Who fell from a third-story window while Paul was speaking late into the night in Troas?","Tychicus","Eutychus","Aristarchus","Sopater",1],
 ["ACT-000049","ACT",20,22,24,"What task did Paul say the Lord Jesus had given him, which he was determined to complete despite the prison and hardships awaiting him?","Rebuild the temple in Jerusalem","Testify to the good news of God's grace","Become a teacher in the Jerusalem church","Establish a synagogue in every Roman city",1],
 ["ACT-000050","ACT",20,35,35,"Who did Paul quote when he said, \"It is more blessed to give than to receive\"?","Moses","David","Peter","The Lord Jesus",3],
 ["ACT-000051","ACT",21,10,11,"How did the prophet Agabus warn Paul about what would happen to him in Jerusalem?","He broke a staff in front of Paul","He took Paul's belt, bound his own hands and feet, and said the Holy Spirit warned that Paul would be bound in Jerusalem","He wrote Paul a letter telling him not to go","He told Paul about a dream he had in Caesarea",1],
 ["ACT-000052","ACT",21,17,18,"Who did Paul visit the day after arriving in Jerusalem?","Peter","John","James","Stephen",2],
 ['GEN-000001','GEN',1,9,13,'What did God create on the third day?','The sun and the moon','Land and seas','Birds and fish','Man and animals',1],
 ['GEN-000002','GEN',1,1,5,'What did God create on the first day?','The sky','Light','Land and seas','The sun and moon',1],
 ['GEN-000003','GEN',1,20,23,'What did God create on the fifth day?','Land animals and mankind','Plants and trees','Birds and creatures of the sea','The sun, moon, and stars',2],
 ['GEN-000004','GEN',2,7,7,'What did God form man from?','Clay from the river','Dust of the ground','Sand from the sea','Stone from the earth',1],
 ['GEN-000005','GEN',2,9,9,'What trees were in the middle of the Garden of Eden?','The tree of life and the tree of knowledge of good and evil','The tree of wisdom and the tree of life','The tree of knowledge and the tree of judgment','The tree of blessing and the tree of wisdom',0],
 ['GEN-000006','GEN',2,10,14,'What four rivers did the river watering the Garden of Eden split into?','Jordan, Nile, Tigris, and Euphrates','Pishon, Gihon, Tigris, and Euphrates','Pishon, Jordan, Nile, and Gihon','Gihon, Jordan, Tigris, and Nile',1],
 ['GEN-000007','GEN',2,16,17,'What tree did God command Adam not to eat from?','The tree of life','The tree of wisdom','The tree of knowledge of good and evil','The tree in the eastern part of the garden',2],
 ['GEN-000008','GEN',2,20,20,'Who named all the livestock, birds, and wild animals?','God','Eve','Adam','Noah',2],
 ['GEN-000009','GEN',2,22,22,'What did God make Eve with?','Dust from the ground',"Adam's rib",'Clay from the earth','A branch from the tree of life',1],
 ['GEN-000010','GEN',3,24,24,'After Adam and Eve ate from the tree of knowledge of good and evil, what did God use to guard the way to the tree of life?','Angels and a wall of fire','Cherubim and a flaming sword','A pillar of fire and a cloud','Cherubim and a wall of thorns',1],
 ['GEN-000011','GEN',3,13,13,'What animal deceived Eve into eating the forbidden fruit?','A lion','A serpent','A raven','A wolf',1],
 ['GEN-000012','GEN',4,8,8,'Who did Cain kill?','Adam','Abel','Enoch','Lamech',1],
 ['GEN-000013','GEN',4,25,25,"What was the name of Adam's third son?",'Abel','Enoch','Seth','Lamech',2],
 ['GEN-000014','GEN',5,1,1,'In whose likeness did God create man?',"Adam's","The angels'","God's","The animals'",2],
 ['GEN-000015','GEN',5,5,5,'How old was Adam when he died?','900 years old','930 years old','950 years old','969 years old',1],
 ['GEN-000016','GEN',5,24,24,'Who did not die, but was taken away by God?','Seth','Methuselah','Enoch','Noah',2],
 ['GEN-000017','GEN',5,32,32,"Who were Noah's three sons?",'Shem, Ham, and Japheth','Cain, Abel, and Seth','Enoch, Lamech, and Seth','Abraham, Nahor, and Haran',0],
 ['GEN-000018','GEN',8,4,4,"Where did Noah's ark come to rest after the waters receded?",'The mountains of Ararat','Mount Sinai','The mountains of Moab','Mount Carmel',0],
 ['GEN-000019','GEN',8,7,7,'What was the first bird Noah sent out to see how far the water had receded?','Dove','Eagle','Raven','Sparrow',2],
 ['GEN-000020','GEN',8,8,8,'What did Noah send out to see if the water had receded from the surface of the ground?','Raven','Dove','Eagle','Sparrow',1],
 ['GEN-000021','GEN',8,11,11,'What did the dove bring back to Noah the second time it returned?','A fig leaf','An olive leaf','A small branch','A cluster of grapes',1],
 ['GEN-000022','GEN',9,13,13,"What is the sign of God's covenant?",'A pillar of fire','A rainbow in the clouds','An olive branch','A star',1],
 ['GEN-000023','GEN',9,29,29,'How old was Noah when he died?','900 years old','930 years old','950 years old','969 years old',2],
 ['GEN-000024','GEN',9,22,25,'Why did Noah curse Canaan, the son of Ham?','Ham stole from Noah',"Ham saw his father's nakedness and told his brothers",'Canaan refused to obey Noah',"Ham destroyed Noah's vineyard",1],
 ['GEN-000025','GEN',10,6,6,'Who were the sons of Ham?','Cush, Egypt, Put, and Canaan','Elam, Asshur, Arpachshad, and Lud','Gomer, Magog, Madai, and Javan','Shem, Cush, Put, and Canaan',0],
 ['GEN-000026','GEN',11,1,1,'How many languages did the people of the world originally speak before the Tower of Babel?','One language','Two languages','Seven languages','Twelve languages',0],
 ['GEN-000027','GEN',11,4,9,'Why was building the Tower of Babel wrong?','The people wanted to make a name for themselves and avoid being scattered over the earth','The people built the tower on land that belonged to Noah','The people were forbidden from building with bricks','The tower was built as a temple for Noah',0],
 ['GEN-000028','GEN',11,9,9,'What does the name "Babel" mean in the context of Genesis 11?','Confusion','Great city','Tower of heaven','Scattering',0],
 ['GEN-000029','GEN',11,10,26,"From which of Noah's three sons was Abram descended?",'Ham','Japheth','Shem','Canaan',2],
 ['GEN-000030','GEN',11,27,31,'How was Lot related to Abram?',"Lot was Abram's brother","Lot was Abram's nephew","Lot was Abram's son","Lot was Abram's cousin",1],
 ['GEN-000031','GEN',12,11,13,'Why did Abram tell Sarai to say that she was his sister?','He wanted Pharaoh to give her land','He was afraid the Egyptians would kill him because of her beauty','He wanted to hide that they had come from Canaan','He was afraid Sarai would be sent back home',1],
 ['GEN-000032','GEN',13,5,9,'Why did Abram and Lot separate from each other?','They disagreed over where to build an altar','The land could not support all their possessions, and their herdsmen were quarreling','Lot wanted to return to Egypt','Abram told Lot to leave because he had disobeyed God',1],
 ['GEN-000033','GEN',16,15,15,"What was the name of Abram's first son, whom Hagar gave birth to?",'Isaac','Ishmael','Esau','Jacob',1],
 ['GEN-000034','GEN',17,9,11,'Why did God command Abraham and the males in his household to be circumcised?','As a sign of the covenant between God and Abraham','To show that Abraham was the leader of his household','As a punishment for leaving his homeland','To prepare them for entering Egypt',0],
 ['GEN-000035','GEN',17,24,25,'How old were Abraham and his son Ishmael when they were circumcised?','Abraham was 75 and Ishmael was 10','Abraham was 90 and Ishmael was 12','Abraham was 99 and Ishmael was 13','Abraham was 100 and Ishmael was 14',2],
 ['GEN-000037','GEN',19,20,23,'What city did Lot flee to when escaping the destruction of Sodom?','Bethel','Zoar','Hebron','Gerar',1],
 ['GEN-000038','GEN',19,17,26,"Why did Lot's wife become a pillar of salt?",'She refused to leave Sodom','She looked back toward Sodom after being commanded not to look back','She tried to return to her home','She disobeyed Lot and fled toward Zoar',1],
 ['GEN-000039','GEN',21,20,20,'What did Ishmael become skilled at as he grew up?','Farming','Hunting with a bow','Building cities','Tending vineyards',1],
 ['GEN-000040','GEN',21,1,3,"What was the name of Abraham and Sarah's son?",'Ishmael','Isaac','Jacob','Esau',1],
 ['GEN-000041','GEN',22,1,2,"How did God test Abraham's faith?",'He told Abraham to return to his homeland','He commanded Abraham to offer his son Isaac as a sacrifice','He told Abraham to give away all his possessions','He commanded Abraham to leave Sarah behind',1],
 ['GEN-000042','GEN',24,2,4,'What mission did Abraham give his chief servant?',"Find a wife for Isaac from Abraham's relatives","Take Isaac back to Abraham's homeland","Find new land for Abraham's household",'Bring Ishmael back to live with Abraham',0],
 ['GEN-000043','GEN',25,9,10,'Where were Abraham and Sarah buried?','The cave of Machpelah','The fields of Beersheba','The mountains of Bethel','The land of Moriah',0],
 ['GEN-000044','GEN',24,67,67,"What was Isaac's wife's name?",'Rachel','Leah','Rebekah','Hagar',2],
 ['GEN-000045','GEN',25,24,26,"What were the names of Isaac and Rebekah's two sons?",'Jacob and Joseph','Esau and Jacob','Ishmael and Isaac','Cain and Abel',1],
 ['GEN-000046','GEN',25,29,34,'How did Jacob get Esau to sell him his birthright?','He offered Esau land and livestock','He gave Esau bread and lentil stew when Esau was hungry','He promised Esau a share of his inheritance','He defeated Esau in a contest',1],
 ['GEN-000047','GEN',26,1,1,'Abimelek was king of what people?','The Egyptians','The Philistines','The Moabites','The Edomites',1],
 ['GEN-000048','GEN',26,16,16,'Why did Abimelek tell Isaac to move away from the Philistines?','Isaac had taken land belonging to the Philistines','Isaac had become too powerful for them','Isaac refused to share his livestock with them','Isaac planned to become king of Gerar',1],
 ['GEN-000049','GEN',27,15,29,"How did Jacob take Esau's blessing from their father Isaac?",'He convinced Esau to give him the blessing in exchange for food','He disguised himself as Esau and deceived Isaac into blessing him','He asked Rebekah to convince Isaac that he deserved the blessing','He waited until Esau left home and claimed the blessing belonged to him',1],
 ['GEN-000050','GEN',28,20,22,'Who is the first person in the Bible recorded vowing to give God a tenth of everything God gave him?','Abraham','Isaac','Jacob','Joseph',2],
 ['GEN-000051','GEN',29,20,27,'How did Laban deceive Jacob after Jacob worked seven years to marry Rachel?','He demanded Jacob work another seven years before allowing him to marry anyone','He gave Jacob Leah as his wife instead of Rachel','He sent Rachel away to another land','He required Jacob to give him all of his livestock',1],
 ['GEN-000052','GEN',29,31,31,'Why was Leah able to have children while Rachel initially could not?','Leah prayed for children before Rachel did','The LORD saw that Leah was not loved and enabled her to conceive','Rachel refused to have children with Jacob','Laban asked God to bless Leah with children',1],
 ['GEN-000053','GEN',29,31,32,"Who was Jacob's firstborn son?",'Joseph','Judah','Reuben','Levi',2],
 ['GEN-000054','GEN',29,21,30,"What were the names of Jacob's four wives?",'Leah, Rachel, Bilhah, and Zilpah','Leah, Rachel, Rebekah, and Hagar','Rachel, Bilhah, Sarah, and Zilpah','Leah, Rebekah, Bilhah, and Keturah',0],
 ['GEN-000055','GEN',30,37,43,'How did Jacob increase the size of his own flocks while working for Laban?',"He secretly took some of Laban's strongest animals",'He selectively bred the stronger animals so that more of the offspring became his','He purchased additional animals from neighboring shepherds','He traded his crops to Laban in exchange for livestock',1],
 ['GEN-000056','GEN',31,19,19,'What did Rachel steal from her father, Laban?','His silver and gold','His household gods','His finest livestock','His family records',1],
 // Supporting reference: Hosea 12:3–4.
 ['GEN-000057','GEN',32,24,30,'Who did Jacob wrestle with through the night?','Esau','Laban','God','An Egyptian soldier',2],
 ['GEN-000058','GEN',33,4,4,'How did Esau react when he saw his brother Jacob returning?','He attacked Jacob and his family','He refused to speak to Jacob','He ran to Jacob, embraced him, kissed him, and wept with him','He demanded that Jacob return his birthright',2],
 // Supporting reference: Genesis 34:2.
 ['GEN-000059','GEN',34,25,27,'Which two of Jacob’s sons attacked the city of Shechem, and why?','Reuben and Judah — because the city stole their livestock','Simeon and Levi — because Shechem had violated their sister Dinah','Joseph and Benjamin — because the city refused to trade with them','Dan and Naphtali — because Shechem had attacked Jacob',1],
 ['GEN-000060','GEN',35,9,10,'What did God change Jacob’s name to?','Abraham','Israel','Judah','Ephraim',1],
 // Full reference: Genesis 30:22–24; 35:16–18.
 ['GEN-000061','GEN',35,16,18,'What were the names of Rachel’s two sons?','Reuben and Simeon','Joseph and Benjamin','Judah and Levi','Dan and Naphtali',1],
 ['GEN-000062','GEN',35,16,19,'How did Rachel die?','She died during childbirth while giving birth to Benjamin','She died from an illness while traveling to Bethel','She was killed during an attack on Jacob’s family','She died during a famine in Canaan',0],
 ['GEN-000063','GEN',35,23,23,'How many sons did Leah give birth to for Jacob?','Four','Five','Six','Seven',2],
 // Supporting reference: Genesis 25:30.
 ['GEN-000064','GEN',36,1,1,'What was Esau also known as?','Edom','Israel','Moab','Midian',0],
 ['GEN-000065','GEN',37,5,11,'What two dreams did Joseph have that he told his brothers?','His brothers’ sheaves bowed down to his sheaf, and the sun, moon, and eleven stars bowed down to him','Seven healthy cows were eaten by seven thin cows, and seven heads of grain were swallowed by seven thin heads','A stairway reached to heaven, and angels went up and down on it','A great tree reached the heavens, and then an angel ordered it to be cut down',0],
 // Supporting reference: Genesis 37:29–30.
 ['GEN-000066','GEN',37,21,22,'Which of Joseph’s brothers tried to save him from being killed by the others?','Judah','Reuben','Simeon','Benjamin',1],
 ['GEN-000067','GEN',37,26,27,'Which of Joseph’s brothers suggested selling him to the Ishmaelites instead of killing him?','Reuben','Simeon','Judah','Levi',2],
 ["GEN-000068","GEN",38,6,11,"Who was Tamar to Judah?","His daughter","His daughter-in-law","His sister","His niece",1],
 ["GEN-000069","GEN",39,1,1,"Who bought Joseph when he was taken to Egypt?","Pharaoh","Potiphar","The chief cupbearer","The prison warden",1],
 ["GEN-000070","GEN",39,20,23,"What responsibility did the prison warden give Joseph?","He became a soldier in Pharaoh's army","He was put in charge of the other prisoners while in prison","He became Pharaoh's chief cupbearer","He became a merchant in Egypt",1],
 ["GEN-000071","GEN",40,1,3,"Who was the master of the chief cupbearer and chief baker?","Potiphar","Pharaoh, king of Egypt","Joseph","The prison warden",1],
 ["GEN-000072","GEN",40,20,22,"Which of Pharaoh's two imprisoned officials was restored to his position?","The chief baker","The chief cupbearer","Both were restored","Neither was restored",1],
 ["GEN-000073","GEN",41,25,32,"What was the meaning of Pharaoh's dreams that Joseph interpreted?","Egypt would have seven years of abundance followed by seven years of famine","Egypt would defeat seven kingdoms and then be conquered by seven others","Pharaoh would reign for fourteen more years","The Nile would flood for seven years and then dry up for seven years",0],
 ["GEN-000074","GEN",41,39,43,"What position did Pharaoh give Joseph after he interpreted Pharaoh's dreams?","Captain of Pharaoh's guard","Overseer of Potiphar's household","Second-in-command over Egypt under Pharaoh","Chief priest of Egypt",2],
 ["GEN-000075","GEN",41,46,46,"How old was Joseph when he entered the service of Pharaoh, king of Egypt?","25 years old","30 years old","35 years old","40 years old",1],
 ["GEN-000076","GEN",41,45,45,"What was the name of Joseph's wife?","Asenath","Tamar","Zipporah","Dinah",0],
 ["GEN-000077","GEN",42,1,5,"Why did Joseph's brothers travel to Egypt?","To search for Joseph","To buy grain because of the famine","To work for Pharaoh","To escape from their father Jacob",1],
 ["GEN-000078","GEN",42,15,20,"What did Joseph require his brothers to do to prove they were not spies?","Bring their youngest brother, Benjamin, to Egypt","Bring their father, Jacob, to Egypt","Return all the grain they had purchased","Work for Pharaoh for one year",0],
 ["EXO-000001","EXO",2,10,10,"What explanation did Pharaoh's daughter give for naming the child Moses?","I drew him out of the water","God has heard my cry","A stranger in a foreign land","The LORD has delivered me",0],
 ["EXO-000002","EXO",2,15,15,"Where did Moses flee when Pharaoh tried to kill him?","Canaan","Midian","Moab","Goshen",1],
 ["EXO-000003","EXO",2,21,21,"What was the name of Moses’ wife?","Miriam","Zipporah","Rebekah","Asenath",1],
 ["EXO-000004","EXO",2,22,22,"What was the name of Moses’ first son?","Gershom","Aaron","Eleazar","Joshua",0],
 ["EXO-000005","EXO",3,1,1,"What was the name of Moses’ father-in-law?","Jethro","Laban","Abimelek","Potiphar",0],
 ["EXO-000006","EXO",3,1,2,"Where did the angel of the LORD first appear to Moses?","Mount Nebo","Mount Carmel","Horeb, the mountain of God","Mount Moriah",2],
 ["EXO-000007","EXO",3,4,4,"How did Moses reply when God called to him from the burning bush?","Speak, LORD","Here I am","What do you want of me?","I am your servant",1],
 ["EXO-000008","EXO",3,10,11,"What mission did God give Moses?","Build an altar in Midian","Bring the Israelites out of Egypt","Lead the Egyptians into Canaan","Return alone to Mount Horeb",1],
 ["EXO-000009","EXO",3,13,14,"How did God respond when Moses asked what name he should give the Israelites?","The God of Abraham","The Almighty","I AM WHO I AM","The God of Horeb",2],
 ["EXO-000010","EXO",4,2,3,"What did God tell Moses to throw on the ground?","His cloak","A stone","His staff","A jar of water",2],
 ["EXO-000011","EXO",4,3,3,"What did Moses’ staff become when he threw it on the ground at God’s command?","A snake","A flame","A branch","A stream of water",0],
 ["EXO-000012","EXO",4,10,10,"What concern about speaking did Moses express when God called him?","He was afraid of traveling through the wilderness","He was concerned that he was not an eloquent speaker","He did not know where Egypt was","He wanted to remain a shepherd forever",1],
 ["EXO-000013","EXO",4,14,16,"Who did God give Moses to help him speak to the people?","Joshua","Jethro","Aaron, his brother","Hur",2],
 // Full counting reference: Exodus 7-12; the linked passage records the final plague.
 ["EXO-000014","EXO",12,29,30,"How many plagues did God bring upon Egypt in the account in Exodus 7-12?","Seven","Eight","Ten","Twelve",2],
 // Supporting reference: Exodus 12:29-30.
 ["EXO-000015","EXO",12,12,13,"Which plague is associated with the first Passover?","The plague of darkness","The plague of locusts","The plague of the firstborn","The plague of frogs",2],
 ["EXO-000016","EXO",12,15,20,"What were the Israelites forbidden to eat during the Feast of Unleavened Bread?","Meat","Anything made with yeast","Grain","Bitter herbs",1],
 ["EXO-000017","EXO",12,17,17,"What festival commemorated the day God brought the Israelites out of Egypt by their divisions?","Festival of Weeks","Festival of Trumpets","Festival of Unleavened Bread","Festival of Tabernacles",2],
 ["EXO-000018","EXO",13,19,19,"Whose bones did Moses carry with him when the Israelites left Egypt?","Abraham’s","Isaac’s","Jacob’s","Joseph’s",3],
 ["EXO-000019","EXO",13,21,21,"How did the LORD guide the Israelites through the wilderness by day?","A pillar of cloud","A pillar of fire","An angel with a sword","A great wind",0],
 ["EXO-000020","EXO",13,21,21,"How did the LORD guide the Israelites through the wilderness by night?","A bright star","A pillar of cloud","A pillar of fire that gave them light","A burning bush",2],
 // Supporting reference: Numbers 26:59 identifies Miriam as the sister of both Moses and Aaron.
 ["EXO-000021","EXO",15,20,20,"What was the name of Aaron's sister, the prophetess who led the women with tambourines?","Miriam","Zipporah","Deborah","Dinah",0],
 ["EXO-000022","EXO",16,13,31,"What was the bread from heaven that the Israelites gathered in the wilderness called?","Quail","Manna","Figs","Barley",1],
 ["EXO-000023","EXO",16,29,30,"On which day were the Israelites commanded to rest?","The first day","The third day","The sixth day","The seventh day",3],
 ["EXO-000024","EXO",17,6,6,"What rock did Moses strike to provide water for the Israelites?","The rock at Horeb","The rock at Bethel","The rock at Midian","The rock at Jericho",0],
 ["EXO-000025","EXO",17,9,12,"Who helped Moses hold up his hands while the Israelites, led by Joshua, fought the Amalekites?","Aaron and Hur","Joshua and Caleb","Jethro and Gershom","Nadab and Abihu",0],
 ['PRO-000001','PRO',3,13,14,'According to Proverbs 3:13–14, what is more valuable than silver and gold?','Strength','Wisdom','Long life','Wealth',1],
 ['ISA-000001','ISA',38,2,5,'Which king prayed to God for his life to be extended and was given fifteen more years?','King David','King Solomon','King Asa','King Hezekiah',3],
 ['MAT-000001','MAT',22,36,38,'What is the greatest and first commandment?','Love the Lord your God with all your heart, soul, and mind','Do not be afraid of evil','Do not commit adultery','Do not murder',0],
 ['JOS-000001','JOS',1,6,6,'What did God command Joshua as he prepared to lead Israel after Moses?','Be strong and courageous','Be wise and merciful','Be patient and silent','Be wealthy and powerful',0],
 ['NUM-000001','NUM',12,7,8,'With whom did God say He spoke face-to-face, clearly and not in riddles?','Joshua','Jeremiah','Isaiah','Moses',3]
];

export function ensureContent(path:string, bibleSources:BibleSource[]=[]){
 const db=new Database(path); db.pragma('journal_mode = WAL');
 if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get()){
  db.exec(contentSchema);
  const book=db.prepare('INSERT INTO books VALUES(?,?,?,?,?)'); BOOKS.forEach((b,i)=>book.run(b[0],b[1],b[2],i+1,b[3]));
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('question_bank_version','1.0-sample');
  const animal=db.prepare('INSERT INTO animals VALUES(?,?,?,?,?)'); AVATARS.forEach((a,i)=>animal.run(...a,i));
  const verse=db.prepare('INSERT INTO verses VALUES(?,?,?,?,?)');
  [[1,'In the beginning, God created the heavens and the earth.'],[2,'The earth was formless and empty. Darkness was on the surface of the deep and God’s Spirit was hovering over the surface of the waters.'],[3,'God said, “Let there be light,” and there was light.'],[4,'God saw the light, and saw that it was good. God divided the light from the darkness.'],[5,'God called the light “day”, and the darkness he called “night”. There was evening and there was morning, the first day.']].forEach(v=>verse.run('BSB','GEN',1,...v));
  [[16,'For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.'],[17,'For God didn’t send his Son into the world to judge the world, but that the world should be saved through him.']].forEach(v=>verse.run('BSB','JHN',3,...v));
  const q=db.prepare('INSERT INTO questions VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  q.run('GEN-000001','GEN',1,1,1,'What did God create in the beginning?','The heavens and the earth','Only the sea','The sun and moon','Humankind',0);
  q.run('GEN-000002','GEN',1,3,3,'What happened when God said, “Let there be light”?','The stars appeared','There was light','Night began','The waters divided',1);
  q.run('JHN-000001','JHN',3,16,17,'Why did God send his Son into the world?','To condemn it','To rule Rome','That the world should be saved through him','To establish an earthly kingdom',2);
 }
 const verseColumns=(db.prepare('PRAGMA table_info(verses)').all() as unknown as {name:string}[]).map(column=>column.name);
 if(!verseColumns.includes('translation_id')){
  db.transaction(()=>{
   db.exec('ALTER TABLE verses RENAME TO legacy_verses; CREATE TABLE verses(translation_id TEXT NOT NULL,book_id TEXT NOT NULL,chapter INTEGER NOT NULL,verse INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(translation_id,book_id,chapter,verse)); CREATE INDEX idx_verses_location ON verses(translation_id,book_id,chapter,verse);');
   db.exec("INSERT INTO verses SELECT 'WEB',book_id,chapter,verse,text FROM legacy_verses; DROP TABLE legacy_verses;");
  })();
 }
 db.exec('CREATE TABLE IF NOT EXISTS translations(id TEXT PRIMARY KEY,name TEXT NOT NULL,abbreviation TEXT NOT NULL,description TEXT NOT NULL,license TEXT NOT NULL,sort_order INTEGER NOT NULL UNIQUE)');
 const saveTranslation=db.prepare('INSERT OR REPLACE INTO translations VALUES(?,?,?,?,?,?)');
 TRANSLATIONS.forEach(item=>saveTranslation.run(item.id,item.name,item.abbreviation,item.description,item.license,item.sortOrder));
 const saveAvatar=db.prepare('INSERT OR REPLACE INTO animals VALUES(?,?,?,?,?)');
 AVATARS.forEach((avatar,index)=>saveAvatar.run(...avatar,index));
 // Content seeding is idempotent so an interrupted first launch repairs itself.
 const repairQuestion=db.prepare('INSERT OR IGNORE INTO questions VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 repairQuestion.run('GEN-000001','GEN',1,1,1,'What did God create in the beginning?','The heavens and the earth','Only the sea','The sun and moon','Humankind',0);
 repairQuestion.run('GEN-000002','GEN',1,3,3,'What happened when God said, “Let there be light”?','The stars appeared','There was light','Night began','The waters divided',1);
 repairQuestion.run('JHN-000001','JHN',3,16,17,'Why did God send his Son into the world?','To condemn it','To rule Rome','That the world should be saved through him','To establish an earthly kingdom',2);
 // The curated list is the sole source of quiz questions, including for existing installs.
 const curatedQuestion=db.prepare('INSERT OR REPLACE INTO questions VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 const syncQuestions=db.transaction(()=>{db.prepare('DELETE FROM questions').run();QUESTIONS.forEach(question=>curatedQuestion.run(...question))});
 syncQuestions();
 db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('question_bank_version','1.12-personal');
 for(const source of bibleSources){
  if(!TRANSLATIONS.some(item=>item.id===source.translationId)||!fs.existsSync(source.file))continue;
  const count=(db.prepare('SELECT COUNT(*) count FROM verses WHERE translation_id=?').get(source.translationId) as {count:number}).count;
  if(count<30000){
   const insert=db.prepare('INSERT OR REPLACE INTO verses(translation_id,book_id,chapter,verse,text) VALUES(?,?,?,?,?)');
   const importBible=db.transaction(()=>{
    db.prepare('DELETE FROM verses WHERE translation_id=?').run(source.translationId);
    for(const line of fs.readFileSync(source.file,'utf8').split(/\r?\n/)){
     if(!line)continue;
     const match=/^(\S+) (\d+):(\d+) (.*)$/.exec(line);
     if(!match)throw new Error(`Invalid ${source.translationId} verse line: ${line.slice(0,80)}`);
     insert.run(source.translationId,WEB_BOOK_IDS[match[1]]??match[1],Number(match[2]),Number(match[3]),match[4]);
    }
    db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run(`bible_version_${source.translationId}`,`${source.translationId}-2026`);
   });
   importBible();
  }
 }
 return db;
}
